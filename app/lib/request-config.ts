import { NextResponse } from "next/server";

export type ApiConfigBody = {
  openai?: unknown;
};

type OpenAIRequestConfig = {
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  localSttUrl: string;
  localTtsUrl: string;
  localTtsVoice: string;
  localVoiceUrl: string;
  sttProvider: "browser" | "cloud" | "local";
  ttsProvider: "browser" | "local";
  visionModel: string;
  realtimeModel: string;
  realtimeVoice: string;
  realtimeTranscriptionModel: string;
};

const defaultBaseUrl = "https://api.openai.com/v1";

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeBaseUrl(baseUrl: string) {
  return (baseUrl || defaultBaseUrl).replace(/\/+$/, "");
}

function readSttProvider(value: unknown) {
  return value === "browser" || value === "local" ? value : "cloud";
}

function readTtsProvider(value: unknown) {
  return value === "local" ? "local" : "browser";
}

export function getOpenAIRequestConfig(body: ApiConfigBody) {
  const openai = body.openai && typeof body.openai === "object"
    ? (body.openai as Record<string, unknown>)
    : {};
  const apiKey = readString(openai.apiKey) || process.env.OPENAI_API_KEY || "";
  const config: OpenAIRequestConfig = {
    apiKey,
    baseUrl: sanitizeBaseUrl(readString(openai.baseUrl) || defaultBaseUrl),
    chatModel:
      readString(openai.chatModel) ||
      process.env.OPENAI_CHAT_MODEL?.trim() ||
      "gpt-5.5",
    localSttUrl:
      readString(openai.localSttUrl) ||
      process.env.LOCAL_STT_URL?.trim() ||
      "http://127.0.0.1:8765/stt",
    localTtsUrl:
      readString(openai.localTtsUrl) ||
      process.env.LOCAL_TTS_URL?.trim() ||
      "http://127.0.0.1:8765/tts",
    localTtsVoice:
      readString(openai.localTtsVoice) ||
      process.env.LOCAL_TTS_VOICE?.trim() ||
      "",
    localVoiceUrl:
      readString(openai.localVoiceUrl) ||
      process.env.LOCAL_VOICE_URL?.trim() ||
      "http://127.0.0.1:8766/voice/turn",
    sttProvider: readSttProvider(openai.sttProvider),
    ttsProvider: readTtsProvider(openai.ttsProvider),
    visionModel:
      readString(openai.visionModel) ||
      process.env.OPENAI_VISION_MODEL?.trim() ||
      "gpt-5.5",
    realtimeModel:
      readString(openai.realtimeModel) ||
      process.env.OPENAI_REALTIME_MODEL?.trim() ||
      "gpt-realtime-2",
    realtimeVoice:
      readString(openai.realtimeVoice) ||
      process.env.OPENAI_REALTIME_VOICE?.trim() ||
      "marin",
    realtimeTranscriptionModel:
      readString(openai.realtimeTranscriptionModel) ||
      process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL?.trim() ||
      "whisper-1",
  };

  return config;
}

export function missingApiKeyResponse(capability: string) {
  return NextResponse.json(
    {
      error: `未配置 OpenAI API Key，无法${capability}。请在进入页面前或设置菜单中保存 API Key。`,
    },
    { status: 503 },
  );
}
