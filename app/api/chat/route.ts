import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "../../lib/rate-limit";
import {
  getOpenAIRequestConfig,
  missingApiKeyResponse,
  type ApiConfigBody,
} from "../../lib/request-config";

type ChatRequestBody = {
  message?: unknown;
  visualContext?: unknown;
} & ApiConfigBody;

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

const maxMessageLength = 800;
const maxVisualContextLength = 900;

function getOutputText(response: OpenAIResponse) {
  if (response.output_text) {
    return response.output_text;
  }

  return response.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(request, {
    namespace: "chat",
    maxRequests: 40,
    windowMs: 60 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  let body: ChatRequestBody;

  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "请求体不是有效 JSON。" }, { status: 400 });
  }

  const message = typeof body.message === "string"
    ? body.message.trim().slice(0, maxMessageLength)
    : "";

  if (!message) {
    return NextResponse.json({ error: "缺少用户问题。" }, { status: 400 });
  }

  const visualContext = typeof body.visualContext === "string"
    ? body.visualContext.trim().slice(0, maxVisualContextLength)
    : "";
  const openaiConfig = getOpenAIRequestConfig(body);

  if (!openaiConfig.apiKey) {
    return missingApiKeyResponse("生成文本回复");
  }

  const prompt = [
    "你是一个 AI 视觉对话助手。",
    "请用简洁自然的中文回答用户。",
    "如果提供了视觉上下文，请结合上下文回答；如果没有，请直接回答语音问题。",
    "除非用户要求详细解释，否则回答不超过 3 句话。",
    visualContext ? `视觉上下文：${visualContext}` : "",
    `用户问题：${message}`,
  ]
    .filter(Boolean)
    .join("\n");
  const responsePayload = {
    model: openaiConfig.chatModel,
    input: prompt,
    max_output_tokens: 360,
    ...(openaiConfig.chatModel.startsWith("gpt-5")
      ? {
          reasoning: { effort: "none" },
          text: { verbosity: "low" },
        }
      : {}),
  };

  let response: Response;

  try {
    response = await fetch(`${openaiConfig.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(responsePayload),
    });
  } catch {
    return NextResponse.json(
      { error: "无法连接文本模型服务，请稍后重试。" },
      { status: 502 },
    );
  }

  const data = (await response.json()) as OpenAIResponse;

  if (!response.ok) {
    return NextResponse.json(
      { error: data.error?.message ?? "文本模型调用失败。" },
      { status: response.status },
    );
  }

  const answer = getOutputText(data);

  if (!answer) {
    return NextResponse.json(
      { error: "文本模型没有返回可展示文本。" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    answer,
    model: openaiConfig.chatModel,
    createdAt: new Date().toISOString(),
  });
}
