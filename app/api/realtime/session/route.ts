import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "../../../lib/rate-limit";

type OpenAIRealtimeClientSecretResponse = {
  client_secret?: {
    value?: string;
    expires_at?: number;
  };
  error?: {
    message?: string;
  };
  id?: string;
};

type RealtimeSessionResponse = {
  clientSecret: string;
  expiresAt: number | null;
  model: string;
  voice: string;
  transcriptionModel: string;
};

function getRealtimeModel() {
  return process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime-2";
}

function getRealtimeVoice() {
  return process.env.OPENAI_REALTIME_VOICE?.trim() || "marin";
}

function getRealtimeTranscriptionModel() {
  return (
    process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL?.trim() ||
    "gpt-4o-mini-transcribe"
  );
}

function createSafetyIdentifier(request: NextRequest) {
  const configuredIdentifier = process.env.OPENAI_SAFETY_IDENTIFIER?.trim();

  if (configuredIdentifier) {
    return configuredIdentifier;
  }

  const forwardedFor = request.headers.get("x-forwarded-for") ?? "";
  const userAgent = request.headers.get("user-agent") ?? "";

  return createHash("sha256")
    .update(`${forwardedFor}:${userAgent}`)
    .digest("hex")
    .slice(0, 32);
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 OPENAI_API_KEY，无法创建 Realtime 临时会话。" },
      { status: 503 },
    );
  }

  const rateLimit = checkRateLimit(request, {
    namespace: "realtime-session",
    maxRequests: 12,
    windowMs: 60 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  const model = getRealtimeModel();
  const voice = getRealtimeVoice();
  const transcriptionModel = getRealtimeTranscriptionModel();
  const safetyIdentifier = createSafetyIdentifier(request);
  const responsePayload = {
    session: {
      type: "realtime",
      model,
      instructions: [
        "你是一个低延迟 AI 视觉对话助手。",
        "你会通过实时语音与用户自然对话，并根据后续注入的视觉上下文回答问题。",
        "正式对话时请用简洁自然的中文回答，并在不确定时明确说明。",
        "如果用户插话或纠正你，请立即停止当前解释，优先回应用户最新输入。",
        "为了控制延迟和成本，除非用户明确要求，否则每次回答不超过 3 句话。",
      ].join("\n"),
      audio: {
        input: {
          transcription: {
            model: transcriptionModel,
            language: "zh",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            create_response: true,
            interrupt_response: true,
          },
        },
        output: {
          voice,
        },
      },
    },
    safety_identifier: safetyIdentifier,
  };

  let response: Response;

  try {
    response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(responsePayload),
    });
  } catch {
    return NextResponse.json(
      { error: "无法连接 Realtime 会话服务，请稍后重试。" },
      { status: 502 },
    );
  }

  const data = (await response.json()) as OpenAIRealtimeClientSecretResponse;

  if (!response.ok) {
    return NextResponse.json(
      { error: data.error?.message ?? "Realtime 临时会话创建失败。" },
      { status: response.status },
    );
  }

  const clientSecret = data.client_secret?.value;

  if (!clientSecret) {
    return NextResponse.json(
      { error: "Realtime 服务没有返回临时 client secret。" },
      { status: 502 },
    );
  }

  const body: RealtimeSessionResponse = {
    clientSecret,
    expiresAt: data.client_secret?.expires_at ?? null,
    model,
    voice,
    transcriptionModel,
  };

  return NextResponse.json(body);
}
