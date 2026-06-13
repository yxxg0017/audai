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

type ChatStreamEvent =
  | { type: "meta"; model?: string }
  | { type: "delta"; text?: string }
  | { type: "done" };

export type VoicePipelineState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") {
    return undefined;
  }

  const globalWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return globalWindow.SpeechRecognition ?? globalWindow.webkitSpeechRecognition;
}

function getSpeechSynthesis() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.speechSynthesis ?? null;
}

function extractSpeakableSegments(text: string) {
  const segments: string[] = [];
  let startIndex = 0;

  for (let index = 0; index < text.length; index += 1) {
    if ("。！？!?；;\n".includes(text[index])) {
      const segment = text.slice(startIndex, index + 1).trim();

      if (segment) {
        segments.push(segment);
      }

      startIndex = index + 1;
    }
  }

  let rest = text.slice(startIndex);

  if (rest.length > 72) {
    const softBreakIndex = Math.max(
      rest.lastIndexOf("，", 64),
      rest.lastIndexOf(",", 64),
      rest.lastIndexOf("、", 64),
      rest.lastIndexOf("：", 64),
      rest.lastIndexOf(":", 64),
    );
    const splitIndex = softBreakIndex > 24 ? softBreakIndex + 1 : 64;
    const segment = rest.slice(0, splitIndex).trim();

    if (segment) {
      segments.push(segment);
    }

    rest = rest.slice(splitIndex);
  }

  return { rest, segments };
}

export function useVoicePipeline() {
  const [state, setState] = useState<VoicePipelineState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [interimTranscript, setInterimTranscript] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);
  const [streamingAnswer, setStreamingAnswer] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const pendingSpeechCountRef = useRef(0);
  const shouldListenRef = useRef(false);

  const stopSpeaking = useCallback(() => {
    const speechSynthesis = getSpeechSynthesis();
    pendingSpeechCountRef.current = 0;

    if (speechSynthesis?.speaking) {
      speechSynthesis.cancel();
    }
  }, []);

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    stopSpeaking();
    setInterimTranscript(null);
    setStreamingAnswer(null);
    setState("idle");
  }, [stopSpeaking]);

  const enqueueSpeech = useCallback((text: string) => {
    const speechSynthesis = getSpeechSynthesis();

    if (!speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      setErrorMessage("当前浏览器不支持语音合成，已完成文本回复但无法播放语音。");
      setState("error");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 1;
    utterance.onend = () => {
      pendingSpeechCountRef.current = Math.max(
        0,
        pendingSpeechCountRef.current - 1,
      );

      if (pendingSpeechCountRef.current === 0) {
        setState(shouldListenRef.current ? "listening" : "idle");
      }
    };
    utterance.onerror = () => {
      pendingSpeechCountRef.current = Math.max(
        0,
        pendingSpeechCountRef.current - 1,
      );
      setErrorMessage("浏览器语音播放失败。");
      setState("error");
    };
    pendingSpeechCountRef.current += 1;
    setState("speaking");
    speechSynthesis.speak(utterance);
    return true;
  }, []);

  const speak = useCallback((text: string) => {
    stopSpeaking();
    enqueueSpeech(text);
  }, [enqueueSpeech, stopSpeaking]);

  const readStreamingAnswer = useCallback(
    async ({
      response,
      onAnswer,
    }: {
      response: Response;
      onAnswer?: (answer: string) => void;
    }) => {
      if (!response.body) {
        const payload = (await response.json()) as ChatApiResponse;

        if (!response.ok || !payload.answer) {
          throw new Error(payload.error ?? "语音流水线文本回复失败。");
        }

        setModel(payload.model ?? null);
        setLastAnswer(payload.answer);
        onAnswer?.(payload.answer);
        speak(payload.answer);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = "";
      let answer = "";
      let speechBuffer = "";

      function handleEvent(event: ChatStreamEvent) {
        if (event.type === "meta") {
          setModel(event.model ?? null);
          return;
        }

        if (event.type !== "delta" || !event.text) {
          return;
        }

        answer += event.text;
        speechBuffer += event.text;
        setLastAnswer(answer);
        setStreamingAnswer(answer);

        const { rest, segments } = extractSpeakableSegments(speechBuffer);
        speechBuffer = rest;
        segments.forEach((segment) => enqueueSpeech(segment));
      }

      function handleLine(line: string) {
        const trimmedLine = line.trim();

        if (!trimmedLine) {
          return;
        }

        try {
          handleEvent(JSON.parse(trimmedLine) as ChatStreamEvent);
        } catch {
          // Ignore malformed stream frames from the local API boundary.
        }
      }

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";
        lines.forEach(handleLine);
      }

      if (lineBuffer) {
        handleLine(lineBuffer);
      }

      if (speechBuffer.trim()) {
        enqueueSpeech(speechBuffer.trim());
      }

      const finalAnswer = answer.trim();

      if (!finalAnswer) {
        throw new Error("文本模型没有返回可展示文本。");
      }

      setStreamingAnswer(null);
      setLastAnswer(finalAnswer);
      onAnswer?.(finalAnswer);
    },
    [enqueueSpeech, speak],
  );

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
      setInterimTranscript(null);
      setStreamingAnswer(null);
      setLastTranscript(trimmedMessage);
      stopSpeaking();

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmedMessage,
            openai: clientConfig,
            visualContext,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as ChatApiResponse;
          throw new Error(payload.error ?? "语音流水线文本回复失败。");
        }

        await readStreamingAnswer({ response, onAnswer });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "语音流水线文本回复失败。";
        setErrorMessage(message);
        setStreamingAnswer(null);
        setState("error");
      }
    },
    [readStreamingAnswer, stopSpeaking],
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
        setErrorMessage("当前浏览器不支持 SpeechRecognition，请使用 Chrome，并通过 localhost 或 HTTPS 访问。");
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
        let interimText = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];

          if (result.isFinal) {
            finalText += result[0].transcript;
          } else {
            interimText += result[0].transcript;
          }
        }

        const trimmedInterimText = interimText.trim();

        if (trimmedInterimText) {
          setInterimTranscript(trimmedInterimText);
        }

        const trimmedText = finalText.trim();

        if (!trimmedText) {
          return;
        }

        setInterimTranscript(null);
        setLastTranscript(trimmedText);
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
    interimTranscript,
    lastAnswer,
    lastTranscript,
    model,
    streamingAnswer,
    state,
    ask,
    start,
    stop,
    stopSpeaking,
  };
}
