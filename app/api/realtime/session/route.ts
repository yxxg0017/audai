import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

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
};

function getRealtimeModel() {
  return process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime-2";
}

function getRealtimeVoice() {
  return process.env.OPENAI_REALTIME_VOICE?.trim() || "marin";
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

  const model = getRealtimeModel();
  const voice = getRealtimeVoice();
  const safetyIdentifier = createSafetyIdentifier(request);
  const responsePayload = {
    session: {
      type: "realtime",
      model,
      instructions: [
        "你是一个低延迟 AI 视觉对话助手。",
        "当前阶段只创建 Realtime 临时会话，前端 WebRTC 音频连接会在后续模块接入。",
        "正式对话时请用简洁自然的中文回答，并在不确定时明确说明。",
      ].join("\n"),
      audio: {
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
  };

  return NextResponse.json(body);
}
