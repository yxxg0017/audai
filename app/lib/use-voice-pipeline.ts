"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientConfig } from "./client-config";

type BackendSttStatus = {
  chunkCount: number;
  errorMessage: string | null;
  lastChunkBytes: number;
  lastRms: number;
  lastTranscript: string | null;
  lastTurnId: string | null;
  mimeType: string | null;
  recordingMs: number;
  state: "idle" | "recording" | "uploading" | "transcribed" | "error";
  uploadedBytes: number;
};

type ChatApiResponse = {
  answer?: string;
  model?: string;
  error?: string;
};

type ChatStreamEvent =
  | { type: "meta"; model?: string }
  | { type: "delta"; text?: string }
  | { type: "done" };

type VoiceSseEvent = {
  audioBase64?: string;
  keywords?: string[];
  message?: string;
  mimeType?: string;
  model?: string;
  name?: string;
  reason?: string;
  recoverable?: boolean;
  summary?: string;
  text?: string;
  turnId?: string;
};

type VisualToolRequest = {
  keywords?: string[];
  name: string;
  reason?: string;
  turnId: string;
};

export type VoicePipelineState =
  | "idle"
  | "listening"
  | "user_speaking"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

const vadThreshold = 0.035;
const speechStartMs = 150;
const silenceEndMs = 700;
const interruptStartMs = 220;
const minSpeechMs = 500;
const maxSpeechMs = 12_000;

function getSupportedAudioMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
  ];

  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
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

  return {
    rest: text.slice(startIndex),
    segments,
  };
}

function toToolResultUrl(localVoiceUrl: string) {
  return localVoiceUrl.replace(/\/voice\/turn\/?$/, "/voice/tool-result");
}

function toHealthUrl(localVoiceUrl: string) {
  try {
    const url = new URL(localVoiceUrl);
    url.pathname = "/health";
    url.search = "";
    return url.toString();
  } catch {
    return localVoiceUrl.replace(/\/voice\/turn\/?$/, "/health");
  }
}

function describeLocalVoiceFetchError(error: unknown, localVoiceUrl: string) {
  const rawMessage = error instanceof Error ? error.message : "";
  const isFetchFailure =
    error instanceof TypeError || rawMessage.toLowerCase().includes("failed to fetch");

  if (!isFetchFailure) {
    return rawMessage || "本地语音会话失败。";
  }

  const hints = [
    `无法连接本地语音服务：${localVoiceUrl}`,
    "请确认已在终端运行 npm run voice:local，并且 /health 可以访问。",
  ];

  try {
    const url = new URL(localVoiceUrl);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      hints.push("如果你在手机或其他局域网设备上打开页面，127.0.0.1 指的是那台设备本身；请把本地语音会话地址改为这台 Mac 的局域网 IP，并用 LOCAL_VOICE_HOST=0.0.0.0 npm run voice:local 启动。");
    }

    if (window.location.protocol === "https:" && url.protocol === "http:") {
      hints.push("当前页面是 HTTPS，但本地语音服务是 HTTP，浏览器可能拦截混合内容；请改用 localhost HTTP 测试，或给本地服务配置 HTTPS。");
    }
  } catch {
    hints.push("本地语音会话地址格式不正确，请在设置中检查。");
  }

  return hints.join(" ");
}

function parseSseBlock(block: string) {
  let event = "message";
  const dataLines: string[] = [];

  block.split("\n").forEach((line) => {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      return;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  });

  return {
    data: dataLines.join("\n"),
    event,
  };
}

function decodeBase64Audio(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

export function useVoicePipeline() {
  const [state, setState] = useState<VoicePipelineState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [interimTranscript, setInterimTranscript] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);
  const [streamingAnswer, setStreamingAnswer] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [backendSttStatus, setBackendSttStatus] = useState<BackendSttStatus>({
    chunkCount: 0,
    errorMessage: null,
    lastChunkBytes: 0,
    lastRms: 0,
    lastTranscript: null,
    lastTurnId: null,
    mimeType: null,
    recordingMs: 0,
    state: "idle",
    uploadedBytes: 0,
  });
  const abortControllerRef = useRef<AbortController | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioPlaybackCountRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);
  const currentClientConfigRef = useRef<ClientConfig | null>(null);
  const currentSpeechStartedAtRef = useRef(0);
  const currentTurnIdRef = useRef<string | null>(null);
  const interruptStartedAtRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false);
  const isTurnInFlightRef = useRef(false);
  const lastAnswerRef = useRef("");
  const lastMeterUpdateAtRef = useRef(0);
  const lastTranscriptRef = useRef("");
  const loudStartedAtRef = useRef<number | null>(null);
  const localAudioRefsRef = useRef<HTMLAudioElement[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const rafRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const shouldListenRef = useRef(false);
  const silenceStartedAtRef = useRef<number | null>(null);
  const speechTurnCountRef = useRef(0);
  const stateRef = useRef<VoicePipelineState>("idle");

  const setPipelineState = useCallback((nextState: VoicePipelineState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const stopSpeaking = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    localAudioRefsRef.current.forEach((audio) => {
      audio.pause();
      audio.src = "";
    });
    localAudioRefsRef.current = [];
    if (shouldListenRef.current && stateRef.current === "speaking") {
      setPipelineState("listening");
    }
  }, [setPipelineState]);

  const playAudioBlob = useCallback(async (blob: Blob) => {
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    audioPlaybackCountRef.current += 1;
    localAudioRefsRef.current.push(audio);

    try {
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("音频播放失败。"));
        void audio.play().catch(reject);
      });
    } finally {
      URL.revokeObjectURL(audioUrl);
      localAudioRefsRef.current = localAudioRefsRef.current.filter(
        (item) => item !== audio,
      );
      audioPlaybackCountRef.current = Math.max(0, audioPlaybackCountRef.current - 1);
      if (
        audioPlaybackCountRef.current === 0 &&
        shouldListenRef.current &&
        stateRef.current === "speaking"
      ) {
        setPipelineState("listening");
      }
    }
  }, [setPipelineState]);

  const enqueueBrowserSpeech = useCallback(async (text: string) => {
    const speechSynthesis = window.speechSynthesis;

    if (!speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      throw new Error("当前浏览器不支持语音合成。");
    }

    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "zh-CN";
      utterance.rate = 1;
      utterance.onend = () => resolve();
      utterance.onerror = () => reject(new Error("浏览器语音播放失败。"));
      speechSynthesis.speak(utterance);
    });
  }, []);

  const speakText = useCallback(
    async (text: string) => {
      const clientConfig = currentClientConfigRef.current;

      if (!clientConfig) {
        return;
      }

      setPipelineState("speaking");

      if (clientConfig.ttsProvider === "local") {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            openai: clientConfig,
            text,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "本地 TTS 合成失败。");
        }

        await playAudioBlob(await response.blob());
        return;
      }

      await enqueueBrowserSpeech(text);
    },
    [enqueueBrowserSpeech, playAudioBlob, setPipelineState],
  );

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
        lastAnswerRef.current = payload.answer;
        setLastAnswer(payload.answer);
        onAnswer?.(payload.answer);
        await speakText(payload.answer);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = "";
      let answer = "";
      let speechBuffer = "";

      async function handleEvent(event: ChatStreamEvent) {
        if (event.type === "meta") {
          setModel(event.model ?? null);
          return;
        }

        if (event.type !== "delta" || !event.text) {
          return;
        }

        answer += event.text;
        speechBuffer += event.text;
        lastAnswerRef.current = answer;
        setLastAnswer(answer);
        setStreamingAnswer(answer);

        const { rest, segments } = extractSpeakableSegments(speechBuffer);
        speechBuffer = rest;
        for (const segment of segments) {
          await speakText(segment);
        }
      }

      async function handleLine(line: string) {
        const trimmedLine = line.trim();

        if (!trimmedLine) {
          return;
        }

        try {
          await handleEvent(JSON.parse(trimmedLine) as ChatStreamEvent);
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
        for (const line of lines) {
          await handleLine(line);
        }
      }

      if (lineBuffer) {
        await handleLine(lineBuffer);
      }

      if (speechBuffer.trim()) {
        await speakText(speechBuffer.trim());
      }

      const finalAnswer = answer.trim();

      if (!finalAnswer) {
        throw new Error("文本模型没有返回可展示文本。");
      }

      setStreamingAnswer(null);
      lastAnswerRef.current = finalAnswer;
      setLastAnswer(finalAnswer);
      onAnswer?.(finalAnswer);
    },
    [speakText],
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
      currentClientConfigRef.current = clientConfig;
      sessionIdRef.current ??= `session-${crypto.randomUUID()}`;

      if (!trimmedMessage) {
        return;
      }

      setPipelineState("thinking");
      setErrorMessage(null);
      setInterimTranscript(null);
      setStreamingAnswer(null);
      lastTranscriptRef.current = trimmedMessage;
      lastAnswerRef.current = "";
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
        setPipelineState(shouldListenRef.current ? "listening" : "idle");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "语音流水线文本回复失败。";
        setErrorMessage(message);
        setStreamingAnswer(null);
        setPipelineState("error");
      }
    },
    [readStreamingAnswer, setPipelineState, stopSpeaking],
  );

  const postToolResult = useCallback(
    async ({
      clientConfig,
      imageDataUrl,
      turnId,
    }: {
      clientConfig: ClientConfig;
      imageDataUrl: string;
      turnId: string;
    }) => {
      await fetch(toToolResultUrl(clientConfig.localVoiceUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl, turnId }),
      });
    },
    [],
  );

  const handleVoiceEvent = useCallback(
    async ({
      clientConfig,
      data,
      event,
      onAnswer,
      onVisualToolCall,
    }: {
      clientConfig: ClientConfig;
      data: VoiceSseEvent;
      event: string;
      onAnswer?: (question: string, answer: string) => void;
      onVisualToolCall?: (request: VisualToolRequest) => Promise<string | undefined>;
    }) => {
      if (event === "stt.final") {
        const text = data.text?.trim() ?? "";
        lastTranscriptRef.current = text;
        setLastTranscript(text);
        setInterimTranscript(null);
        setBackendSttStatus((current) => ({
          ...current,
          lastTranscript: text || current.lastTranscript,
          state: "transcribed",
        }));
        return;
      }

      if (event === "tool.call" && data.turnId && data.name) {
        const imageDataUrl = await onVisualToolCall?.({
          keywords: data.keywords,
          name: data.name,
          reason: data.reason,
          turnId: data.turnId,
        });
        if (imageDataUrl) {
          await postToolResult({ clientConfig, imageDataUrl, turnId: data.turnId });
        }
        return;
      }

      if (event === "tool.result") {
        setInterimTranscript(data.summary ?? null);
        return;
      }

      if (event === "llm.delta") {
        const text = data.text ?? "";
        setPipelineState("thinking");
        lastAnswerRef.current += text;
        setLastAnswer(lastAnswerRef.current);
        setStreamingAnswer(lastAnswerRef.current);
        return;
      }

      if (event === "tts.start") {
        setPipelineState("speaking");
        return;
      }

      if (event === "tts.audio" && data.audioBase64) {
        const blob = decodeBase64Audio(data.audioBase64, data.mimeType ?? "audio/aiff");
        void playAudioBlob(blob);
        return;
      }

      if (event === "tts.stop") {
        if (audioPlaybackCountRef.current === 0) {
          setPipelineState(shouldListenRef.current ? "listening" : "idle");
        }
        return;
      }

      if (event === "done") {
        const question = lastTranscriptRef.current.trim();
        const answer = lastAnswerRef.current.trim();
        setStreamingAnswer(null);
        if (question && answer) {
          onAnswer?.(question, answer);
        }
        setPipelineState(shouldListenRef.current ? "listening" : "idle");
        return;
      }

      if (event === "error") {
        throw new Error(data.message ?? "本地语音服务返回错误。");
      }
    },
    [playAudioBlob, postToolResult, setPipelineState],
  );

  const sendVoiceTurn = useCallback(
    async ({
      blob,
      clientConfig,
      onAnswer,
      onVisualToolCall,
    }: {
      blob: Blob;
      clientConfig: ClientConfig;
      onAnswer?: (question: string, answer: string) => void;
      onVisualToolCall?: (request: VisualToolRequest) => Promise<string | undefined>;
    }) => {
      const turnId = `turn-${Date.now()}-${speechTurnCountRef.current + 1}`;
      currentTurnIdRef.current = turnId;
      speechTurnCountRef.current += 1;
      isTurnInFlightRef.current = true;
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      setPipelineState("transcribing");
      setErrorMessage(null);
      lastAnswerRef.current = "";
      lastTranscriptRef.current = "";
      setLastAnswer(null);
      setStreamingAnswer(null);
      setBackendSttStatus((current) => ({
        ...current,
        chunkCount: speechTurnCountRef.current,
        lastChunkBytes: blob.size,
        lastTurnId: turnId,
        mimeType: blob.type || current.mimeType,
        state: "uploading",
        uploadedBytes: current.uploadedBytes + blob.size,
      }));

      const formData = new FormData();
      formData.set("audio", blob, `audai-${turnId}.webm`);
      formData.set("config", JSON.stringify(clientConfig));
      formData.set("sessionId", sessionIdRef.current ?? `session-${turnId}`);
      formData.set("turnId", turnId);

      try {
        const response = await fetch(clientConfig.localVoiceUrl, {
          body: formData,
          method: "POST",
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error("本地语音会话服务不可用。");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        async function handleBlock(block: string) {
          const parsed = parseSseBlock(block);
          if (!parsed.data) {
            return;
          }
          await handleVoiceEvent({
            clientConfig,
            data: JSON.parse(parsed.data) as VoiceSseEvent,
            event: parsed.event,
            onAnswer,
            onVisualToolCall,
          });
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            await handleBlock(block);
          }
        }

        if (buffer.trim()) {
          await handleBlock(buffer);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setPipelineState(shouldListenRef.current ? "listening" : "idle");
          return;
        }
        const message = describeLocalVoiceFetchError(error, clientConfig.localVoiceUrl);
        setErrorMessage(message);
        setBackendSttStatus((current) => ({
          ...current,
          errorMessage: message,
          state: "error",
        }));
        setPipelineState("error");
      } finally {
        isTurnInFlightRef.current = false;
        abortControllerRef.current = null;
        if (
          shouldListenRef.current &&
          stateRef.current !== "error" &&
          audioPlaybackCountRef.current === 0
        ) {
          setPipelineState("listening");
        }
      }
    },
    [handleVoiceEvent, setPipelineState],
  );

  const checkLocalVoiceService = useCallback(
    async (clientConfig: ClientConfig) => {
      try {
        const response = await fetch(toHealthUrl(clientConfig.localVoiceUrl), {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`本地语音服务健康检查失败：HTTP ${response.status}`);
        }

        const payload = (await response.json().catch(() => null)) as
          | { checks?: Record<string, boolean>; ok?: boolean }
          | null;

        if (payload && payload.ok === false) {
          const failedChecks = Object.entries(payload.checks ?? {})
            .filter(([, ok]) => !ok)
            .map(([name]) => name)
            .join("、");
          throw new Error(
            failedChecks
              ? `本地语音服务未就绪，失败检查：${failedChecks}。`
              : "本地语音服务未就绪。",
          );
        }
      } catch (error) {
        const message = describeLocalVoiceFetchError(error, clientConfig.localVoiceUrl);
        setErrorMessage(message);
        setBackendSttStatus((current) => ({
          ...current,
          errorMessage: message,
          state: "error",
        }));
        setPipelineState("error");
        shouldListenRef.current = false;
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        void audioContextRef.current?.close();
        audioContextRef.current = null;
        analyserRef.current = null;
      }
    },
    [setPipelineState],
  );

  const stopRecorder = useCallback(() => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      return;
    }
    mediaRecorderRef.current.stop();
  }, []);

  const startRecorder = useCallback(
    ({
      clientConfig,
      onAnswer,
      onVisualToolCall,
      stream,
    }: {
      clientConfig: ClientConfig;
      onAnswer?: (question: string, answer: string) => void;
      onVisualToolCall?: (request: VisualToolRequest) => Promise<string | undefined>;
      stream: MediaStream;
    }) => {
      if (typeof MediaRecorder === "undefined") {
        setErrorMessage("当前浏览器不支持 MediaRecorder，无法录制语音。");
        setPipelineState("error");
        return;
      }

      stopSpeaking();
      chunksRef.current = [];
      isRecordingRef.current = true;
      currentSpeechStartedAtRef.current = performance.now();
      setPipelineState("user_speaking");
      setBackendSttStatus((current) => ({
        ...current,
        errorMessage: null,
        recordingMs: 0,
        state: "recording",
      }));

      const mimeType = getSupportedAudioMimeType();
      const recorder = new MediaRecorder(
        new MediaStream(stream.getAudioTracks()),
        mimeType ? { mimeType } : undefined,
      );

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const speechDuration = performance.now() - currentSpeechStartedAtRef.current;
        isRecordingRef.current = false;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        chunksRef.current = [];
        setBackendSttStatus((current) => ({
          ...current,
          recordingMs: Math.round(speechDuration),
        }));
        if (blob.size < 1024 || speechDuration < minSpeechMs || !shouldListenRef.current) {
          setPipelineState(shouldListenRef.current ? "listening" : "idle");
          return;
        }
        void sendVoiceTurn({
          blob,
          clientConfig,
          onAnswer,
          onVisualToolCall,
        });
      };
      recorder.onerror = () => {
        isRecordingRef.current = false;
        setErrorMessage("MediaRecorder 录音失败。");
        setPipelineState("error");
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
    },
    [sendVoiceTurn, setPipelineState, stopSpeaking],
  );

  const startVadLoop = useCallback(
    ({
      clientConfig,
      onAnswer,
      onVisualToolCall,
      stream,
    }: {
      clientConfig: ClientConfig;
      onAnswer?: (question: string, answer: string) => void;
      onVisualToolCall?: (request: VisualToolRequest) => Promise<string | undefined>;
      stream: MediaStream;
    }) => {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) {
        setErrorMessage("当前浏览器不支持 Web Audio VAD。");
        setPipelineState("error");
        return;
      }

      const audioContext = new AudioContextConstructor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      const samples = new Uint8Array(analyser.fftSize);
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      function getRms() {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const normalized = (samples[index] - 128) / 128;
          sum += normalized * normalized;
        }
        return Math.sqrt(sum / samples.length);
      }

      function tick(now: number) {
        if (!shouldListenRef.current) {
          return;
        }

        const rms = getRms();
        const isLoud = rms >= vadThreshold;
        const currentState = stateRef.current;

        if (now - lastMeterUpdateAtRef.current > 150) {
          lastMeterUpdateAtRef.current = now;
          setBackendSttStatus((current) => ({
            ...current,
            lastRms: rms,
            recordingMs: isRecordingRef.current
              ? Math.round(now - currentSpeechStartedAtRef.current)
              : current.recordingMs,
          }));
        }

        if (currentState === "speaking" && isLoud) {
          interruptStartedAtRef.current ??= now;
          if (now - interruptStartedAtRef.current >= interruptStartMs) {
            stopSpeaking();
          }
        } else if (!isLoud) {
          interruptStartedAtRef.current = null;
        }

        const canStartRecording =
          !isTurnInFlightRef.current &&
          (stateRef.current === "listening" || stateRef.current === "speaking");

        if (!isRecordingRef.current && canStartRecording && isLoud) {
          loudStartedAtRef.current ??= now;
          if (now - loudStartedAtRef.current >= speechStartMs) {
            startRecorder({
              clientConfig,
              onAnswer,
              onVisualToolCall,
              stream,
            });
            loudStartedAtRef.current = null;
            silenceStartedAtRef.current = null;
          }
        }

        if (isRecordingRef.current) {
          if (!isLoud) {
            silenceStartedAtRef.current ??= now;
          } else {
            silenceStartedAtRef.current = null;
          }

          const speechDuration = now - currentSpeechStartedAtRef.current;
          const shouldEndBySilence =
            silenceStartedAtRef.current !== null &&
            now - silenceStartedAtRef.current >= silenceEndMs;

          if (shouldEndBySilence || speechDuration >= maxSpeechMs) {
            stopRecorder();
          }
        }

        rafRef.current = requestAnimationFrame(tick);
      }

      rafRef.current = requestAnimationFrame(tick);
    },
    [setPipelineState, startRecorder, stopRecorder, stopSpeaking],
  );

  const start = useCallback(
    ({
      clientConfig,
      onAnswer,
      onVisualToolCall,
      stream,
    }: {
      clientConfig: ClientConfig;
      onAnswer?: (question: string, answer: string) => void;
      onFinalTranscript?: (text: string) => Promise<string | undefined>;
      onVisualToolCall?: (request: VisualToolRequest) => Promise<string | undefined>;
      stream?: MediaStream | null;
    }) => {
      if (!stream?.getAudioTracks().length) {
        setErrorMessage("未找到麦克风流，无法启动语音会话。");
        setPipelineState("error");
        return false;
      }

      if (shouldListenRef.current && rafRef.current !== null) {
        currentClientConfigRef.current = clientConfig;
        return true;
      }

      currentClientConfigRef.current = clientConfig;
      sessionIdRef.current ??= `session-${crypto.randomUUID()}`;
      shouldListenRef.current = true;
      setErrorMessage(null);
      setInterimTranscript(null);
      setStreamingAnswer(null);
      lastAnswerRef.current = "";
      lastTranscriptRef.current = "";
      setPipelineState("listening");
      setBackendSttStatus({
        chunkCount: 0,
        errorMessage: null,
        lastChunkBytes: 0,
        lastRms: 0,
        lastTranscript: null,
        lastTurnId: null,
        mimeType: null,
        recordingMs: 0,
        state: "idle",
        uploadedBytes: 0,
      });
      startVadLoop({
        clientConfig,
        onAnswer,
        onVisualToolCall,
        stream,
      });
      void checkLocalVoiceService(clientConfig);
      return true;
    },
    [checkLocalVoiceService, setPipelineState, startVadLoop],
  );

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    isTurnInFlightRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    stopSpeaking();
    stopRecorder();
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
    setInterimTranscript(null);
    setStreamingAnswer(null);
    setBackendSttStatus((current) => ({
      ...current,
      state: "idle",
    }));
    setPipelineState("idle");
  }, [setPipelineState, stopRecorder, stopSpeaking]);

  useEffect(() => stop, [stop]);

  return {
    errorMessage,
    backendSttStatus,
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

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
