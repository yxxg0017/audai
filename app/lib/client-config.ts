"use client";

export type ClientConfig = {
  apiKey: string;
  baseUrl: string;
  voiceMode: "pipeline" | "realtime";
  chatModel: string;
  realtimeModel: string;
  realtimeVoice: string;
  realtimeTranscriptionModel: string;
  visionModel: string;
};

export const defaultClientConfig: ClientConfig = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  voiceMode: "pipeline",
  chatModel: "gpt-5.5",
  realtimeModel: "gpt-realtime-2",
  realtimeVoice: "marin",
  realtimeTranscriptionModel: "gpt-4o-mini-transcribe",
  visionModel: "gpt-5.5",
};

const storageKey = "audai.client-config.v1";

function sanitizeBaseUrl(baseUrl: string) {
  const trimmedUrl = baseUrl.trim().replace(/\/+$/, "");

  if (!trimmedUrl) {
    return defaultClientConfig.baseUrl;
  }

  return trimmedUrl;
}

export function normalizeClientConfig(config: Partial<ClientConfig>): ClientConfig {
  return {
    apiKey: config.apiKey?.trim() ?? "",
    baseUrl: sanitizeBaseUrl(config.baseUrl ?? defaultClientConfig.baseUrl),
    voiceMode: config.voiceMode === "realtime" ? "realtime" : "pipeline",
    chatModel: config.chatModel?.trim() || defaultClientConfig.chatModel,
    realtimeModel:
      config.realtimeModel?.trim() || defaultClientConfig.realtimeModel,
    realtimeVoice:
      config.realtimeVoice?.trim() || defaultClientConfig.realtimeVoice,
    realtimeTranscriptionModel:
      config.realtimeTranscriptionModel?.trim() ||
      defaultClientConfig.realtimeTranscriptionModel,
    visionModel: config.visionModel?.trim() || defaultClientConfig.visionModel,
  };
}

export function loadClientConfig() {
  if (typeof window === "undefined") {
    return defaultClientConfig;
  }

  const rawConfig = window.localStorage.getItem(storageKey);

  if (!rawConfig) {
    return defaultClientConfig;
  }

  try {
    return normalizeClientConfig(JSON.parse(rawConfig) as Partial<ClientConfig>);
  } catch {
    return defaultClientConfig;
  }
}

export function saveClientConfig(config: ClientConfig) {
  window.localStorage.setItem(
    storageKey,
    JSON.stringify(normalizeClientConfig(config)),
  );
}

export function clearClientConfig() {
  window.localStorage.removeItem(storageKey);
}

export function isClientConfigReady(config: ClientConfig) {
  return Boolean(config.apiKey.trim() && config.baseUrl.trim());
}
