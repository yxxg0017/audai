import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "../../lib/rate-limit";
import {
  getOpenAIRequestConfig,
  type ApiConfigBody,
} from "../../lib/request-config";

type TtsRequestBody = {
  text?: unknown;
} & ApiConfigBody;

type LocalTtsJsonResponse = {
  audioBase64?: string;
  mimeType?: string;
  error?: string;
};

const maxTtsTextLength = 600;

function readContentType(response: Response) {
  return response.headers.get("content-type") ?? "audio/wav";
}

async function readLocalTtsError(response: Response) {
  const text = await response.text();

  try {
    const data = JSON.parse(text) as LocalTtsJsonResponse;
    return data.error ?? (text || "本地 TTS 合成失败。");
  } catch {
    return text || "本地 TTS 合成失败。";
  }
}

function decodeBase64Audio(base64: string) {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(request, {
    namespace: "tts",
    maxRequests: 240,
    windowMs: 60 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  let body: TtsRequestBody;

  try {
    body = (await request.json()) as TtsRequestBody;
  } catch {
    return NextResponse.json({ error: "请求体不是有效 JSON。" }, { status: 400 });
  }

  const text =
    typeof body.text === "string" ? body.text.trim().slice(0, maxTtsTextLength) : "";

  if (!text) {
    return NextResponse.json({ error: "缺少待合成文本。" }, { status: 400 });
  }

  const config = getOpenAIRequestConfig(body);

  if (config.ttsProvider !== "local") {
    return NextResponse.json(
      { error: "当前未启用本地 TTS。请在设置中选择本地 TTS 模型。" },
      { status: 400 },
    );
  }

  let response: Response;

  try {
    response = await fetch(config.localTtsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice: config.localTtsVoice || undefined,
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "无法连接本地 TTS 服务，请检查本地 TTS 地址。" },
      { status: 502 },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: await readLocalTtsError(response) },
      { status: response.status },
    );
  }

  const contentType = readContentType(response);

  if (contentType.includes("application/json")) {
    const data = (await response.json()) as LocalTtsJsonResponse;

    if (!data.audioBase64) {
      return NextResponse.json(
        { error: data.error ?? "本地 TTS 没有返回音频。" },
        { status: 502 },
      );
    }

    return new Response(decodeBase64Audio(data.audioBase64), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": data.mimeType ?? "audio/wav",
      },
    });
  }

  return new Response(await response.arrayBuffer(), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
    },
  });
}
