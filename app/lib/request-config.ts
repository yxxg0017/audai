import { NextResponse } from "next/server";

export type ApiConfigBody = {
  openai?: unknown;
};

type OpenAIRequestConfig = {
  apiKey: string;
  baseUrl: string;
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

export function getOpenAIRequestConfig(body: ApiConfigBody) {
  const openai = body.openai && typeof body.openai === "object"
    ? (body.openai as Record<string, unknown>)
    : {};
  const apiKey = readString(openai.apiKey) || process.env.OPENAI_API_KEY || "";
  const config: OpenAIRequestConfig = {
    apiKey,
    baseUrl: sanitizeBaseUrl(readString(openai.baseUrl) || defaultBaseUrl),
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
      "gpt-4o-mini-transcribe",
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
