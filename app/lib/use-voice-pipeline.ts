"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientConfig } from "./client-config";

type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
};

type SpeechRecognitionErrorEventLike = Event & {
  error?: string;
};

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type ChatApiResponse = {
  answer?: string;
  model?: string;
  error?: string;
};

export type VoicePipelineState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

function getSpeechRecognitionConstructor() {
  const globalWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return globalWindow.SpeechRecognition ?? globalWindow.webkitSpeechRecognition;
}

export function useVoicePipeline() {
  const [state, setState] = useState<VoicePipelineState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldListenRef = useRef(false);

  const stopSpeaking = useCallback(() => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    stopSpeaking();
    setState("idle");
  }, [stopSpeaking]);

  const speak = useCallback((text: string) => {
    stopSpeaking();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 1;
    utterance.onend = () => {
      setState(shouldListenRef.current ? "listening" : "idle");
    };
    utterance.onerror = () => {
      setErrorMessage("浏览器语音播放失败。");
      setState("error");
    };
    setState("speaking");
    window.speechSynthesis.speak(utterance);
  }, [stopSpeaking]);

  const ask = useCallback(
    async ({
      clientConfig,
      message,
      onAnswer,
      visualContext,
    }: {
      clientConfig: ClientConfig;
      message: string;
      onAnswer?: (answer: string) => void;
      visualContext?: string;
    }) => {
      const trimmedMessage = message.trim();

      if (!trimmedMessage) {
        return;
      }

      setState("thinking");
      setErrorMessage(null);
      setLastTranscript(trimmedMessage);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmedMessage,
          openai: clientConfig,
          visualContext,
        }),
      });
      const payload = (await response.json()) as ChatApiResponse;

      if (!response.ok || !payload.answer) {
        const message = payload.error ?? "语音流水线文本回复失败。";
        setErrorMessage(message);
        setState("error");
        return;
      }

      setLastAnswer(payload.answer);
      setModel(payload.model ?? null);
      onAnswer?.(payload.answer);
      speak(payload.answer);
    },
    [speak],
  );

  const start = useCallback(
    ({
      clientConfig,
      onAnswer,
      onFinalTranscript,
    }: {
      clientConfig: ClientConfig;
      onAnswer?: (question: string, answer: string) => void;
      onFinalTranscript?: (text: string) => Promise<string | undefined>;
    }) => {
      const SpeechRecognition = getSpeechRecognitionConstructor();

      if (!SpeechRecognition) {
        setErrorMessage("当前浏览器不支持 SpeechRecognition，请使用 Chrome 测试。");
        setState("error");
        return false;
      }

      stopSpeaking();
      shouldListenRef.current = true;
      setErrorMessage(null);

      const recognition = new SpeechRecognition();
      recognition.lang = "zh-CN";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognitionRef.current = recognition;

      recognition.onresult = (event) => {
        let finalText = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];

          if (result.isFinal) {
            finalText += result[0].transcript;
          }
        }

        const trimmedText = finalText.trim();

        if (!trimmedText) {
          return;
        }

        stopSpeaking();
        void (async () => {
          const visualContext = await onFinalTranscript?.(trimmedText);
          await ask({
            clientConfig,
            message: trimmedText,
            onAnswer: (answer) => onAnswer?.(trimmedText, answer),
            visualContext,
          });
        })();
      };

      recognition.onerror = (event) => {
        setErrorMessage(event.error ?? "语音识别失败。");
        setState("error");
      };

      recognition.onend = () => {
        if (shouldListenRef.current) {
          try {
            recognition.start();
            setState("listening");
          } catch {
            setState("idle");
          }
        }
      };

      recognition.start();
      setState("listening");
      return true;
    },
    [ask, stopSpeaking],
  );

  useEffect(() => stop, [stop]);

  return {
    errorMessage,
    lastAnswer,
    lastTranscript,
    model,
    state,
    ask,
    start,
    stop,
    stopSpeaking,
  };
}
