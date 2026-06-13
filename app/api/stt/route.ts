import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "../../lib/rate-limit";
import {
  getOpenAIRequestConfig,
  missingApiKeyResponse,
} from "../../lib/request-config";

type SttResponse = {
  text?: string;
  error?: {
    message?: string;
  };
};

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

  if (!openaiConfig.apiKey) {
    return missingApiKeyResponse("进行语音转写");
  }

  const transcriptionForm = new FormData();
  transcriptionForm.set("model", openaiConfig.realtimeTranscriptionModel);
  transcriptionForm.set("language", "zh");
  transcriptionForm.set(
    "file",
    audio,
    `audai-chunk-${formData.get("chunkIndex") ?? Date.now()}.${getFileExtension(audio.type)}`,
  );

  let response: Response;

  try {
    response = await fetch(`${openaiConfig.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiConfig.apiKey}`,
      },
      body: transcriptionForm,
    });
  } catch {
    return NextResponse.json(
      { error: "无法连接语音转写服务，请检查 Base URL。" },
      { status: 502 },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: await readErrorResponse(response) },
      { status: response.status },
    );
  }

  const data = (await response.json()) as SttResponse;

  return NextResponse.json({
    bytes: audio.size,
    chunkIndex: Number(formData.get("chunkIndex") ?? 0),
    mimeType: audio.type,
    model: openaiConfig.realtimeTranscriptionModel,
    text: data.text?.trim() ?? "",
  });
}
