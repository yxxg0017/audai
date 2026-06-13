import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "../../lib/rate-limit";
import {
  getOpenAIRequestConfig,
  missingApiKeyResponse,
} from "../../lib/request-config";

type SttResponse = {
  model?: string;
  text?: string;
  error?: {
    message?: string;
  };
};

type SttAttempt =
  | { ok: true; data: SttResponse; model: string; response: Response }
  | { ok: false; error: string; model: string; response: Response };

function getFileExtension(mimeType: string) {
  if (mimeType.includes("mp4")) {
    return "mp4";
  }

  if (mimeType.includes("mpeg")) {
    return "mp3";
  }

  if (mimeType.includes("wav")) {
    return "wav";
  }

  return "webm";
}

function parseOpenAIConfig(rawConfig: FormDataEntryValue | null) {
  if (typeof rawConfig !== "string") {
    return {};
  }

  try {
    return JSON.parse(rawConfig) as unknown;
  } catch {
    return {};
  }
}

async function readErrorResponse(response: Response) {
  const text = await response.text();

  try {
    const data = JSON.parse(text) as SttResponse;
    return data.error?.message ?? (text || "语音转写失败。");
  } catch {
    return text || "语音转写失败。";
  }
}

function shouldRetryWithFallback(message: string) {
  return [
    "no available channel",
    "model_not_found",
    "not found",
    "not implemented",
    "unsupported",
  ].some((keyword) => message.toLowerCase().includes(keyword));
}

function getTranscriptionModels(configuredModel: string) {
  return Array.from(new Set([configuredModel, "whisper-1"]));
}

async function requestTranscription({
  audio,
  baseUrl,
  apiKey,
  chunkIndex,
  model,
}: {
  audio: File;
  baseUrl: string;
  apiKey: string;
  chunkIndex: FormDataEntryValue | null;
  model: string;
}): Promise<SttAttempt> {
  const transcriptionForm = new FormData();
  transcriptionForm.set("model", model);
  transcriptionForm.set("language", "zh");
  transcriptionForm.set(
    "file",
    audio,
    `audai-chunk-${chunkIndex ?? Date.now()}.${getFileExtension(audio.type)}`,
  );

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: transcriptionForm,
  });

  if (!response.ok) {
    return {
      ok: false,
      error: await readErrorResponse(response),
      model,
      response,
    };
  }

  return {
    ok: true,
    data: (await response.json()) as SttResponse,
    model,
    response,
  };
}

async function requestLocalTranscription({
  audio,
  chunkIndex,
  localSttUrl,
}: {
  audio: File;
  chunkIndex: FormDataEntryValue | null;
  localSttUrl: string;
}): Promise<SttAttempt> {
  const localForm = new FormData();
  localForm.set(
    "audio",
    audio,
    `audai-chunk-${chunkIndex ?? Date.now()}.${getFileExtension(audio.type)}`,
  );

  const response = await fetch(localSttUrl, {
    method: "POST",
    body: localForm,
  });

  if (!response.ok) {
    return {
      ok: false,
      error: await readErrorResponse(response),
      model: "local-stt",
      response,
    };
  }

  return {
    ok: true,
    data: (await response.json()) as SttResponse,
    model: "local-stt",
    response,
  };
}

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(request, {
    namespace: "stt",
    maxRequests: 180,
    windowMs: 60 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "请求体不是有效表单。" }, { status: 400 });
  }

  const audio = formData.get("audio");

  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: "缺少有效音频分片。" }, { status: 400 });
  }

  const openaiConfig = getOpenAIRequestConfig({
    openai: parseOpenAIConfig(formData.get("openai")),
  });

  if (openaiConfig.sttProvider === "browser") {
    return NextResponse.json({
      bytes: audio.size,
      chunkIndex: Number(formData.get("chunkIndex") ?? 0),
      mimeType: audio.type,
      model: "browser",
      text: "",
    });
  }

  if (openaiConfig.sttProvider !== "local" && !openaiConfig.apiKey) {
    return missingApiKeyResponse("进行语音转写");
  }

  let result: SttAttempt | null = null;

  try {
    if (openaiConfig.sttProvider === "local") {
      result = await requestLocalTranscription({
        audio,
        chunkIndex: formData.get("chunkIndex"),
        localSttUrl: openaiConfig.localSttUrl,
      });
    } else {
      for (const model of getTranscriptionModels(
        openaiConfig.realtimeTranscriptionModel,
      )) {
        result = await requestTranscription({
          apiKey: openaiConfig.apiKey,
          audio,
          baseUrl: openaiConfig.baseUrl,
          chunkIndex: formData.get("chunkIndex"),
          model,
        });

        if (result.ok || !shouldRetryWithFallback(result.error)) {
          break;
        }
      }
    }
  } catch {
    return NextResponse.json(
      { error: "无法连接语音转写服务，请检查 Base URL。" },
      { status: 502 },
    );
  }

  if (!result) {
    return NextResponse.json(
      { error: "语音转写没有返回结果。" },
      { status: 502 },
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, model: result.model },
      { status: result.response.status },
    );
  }

  return NextResponse.json({
    bytes: audio.size,
    chunkIndex: Number(formData.get("chunkIndex") ?? 0),
    mimeType: audio.type,
    model: result.data.model ?? result.model,
    text: result.data.text?.trim() ?? "",
  });
}
