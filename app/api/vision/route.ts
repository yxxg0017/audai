import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "../../lib/rate-limit";
import {
  getOpenAIRequestConfig,
  missingApiKeyResponse,
  type ApiConfigBody,
} from "../../lib/request-config";

type VisionRequestBody = {
  imageDataUrl?: unknown;
  question?: unknown;
} & ApiConfigBody;

type ChatCompletionMessage = {
  content?: string | Array<{ text?: string }>;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: ChatCompletionMessage;
  }>;
  model?: string;
  usage?: unknown;
  error?: {
    message?: string;
  };
};

const MAX_IMAGE_DATA_URL_LENGTH = 2_000_000;
const MAX_QUESTION_LENGTH = 500;
const imageDataUrlPattern = /^data:image\/(?:jpeg|jpg|png|webp);base64,/;

function getMessageText(message?: ChatCompletionMessage) {
  if (!message?.content) {
    return "";
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .map((content) => content.text)
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function readErrorResponse(response: Response) {
  const text = await response.text();

  try {
    const data = JSON.parse(text) as ChatCompletionResponse;
    return data.error?.message ?? (text || "视觉模型调用失败。");
  } catch {
    return text || "视觉模型调用失败。";
  }
}

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(request, {
    namespace: "vision",
    maxRequests: 20,
    windowMs: 60 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  let body: VisionRequestBody;

  try {
    body = (await request.json()) as VisionRequestBody;
  } catch {
    return NextResponse.json({ error: "请求体不是有效 JSON。" }, { status: 400 });
  }

  if (
    typeof body.imageDataUrl !== "string" ||
    !imageDataUrlPattern.test(body.imageDataUrl)
  ) {
    return NextResponse.json(
      { error: "缺少有效的图片 data URL。" },
      { status: 400 },
    );
  }

  if (body.imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    return NextResponse.json(
      { error: "图片过大，请先降低抽帧尺寸或压缩质量。" },
      { status: 413 },
    );
  }

  const openaiConfig = getOpenAIRequestConfig(body);

  if (!openaiConfig.apiKey) {
    return missingApiKeyResponse("进行视觉分析");
  }

  const question =
    typeof body.question === "string" && body.question.trim()
      ? body.question.trim().slice(0, MAX_QUESTION_LENGTH)
      : "请用中文简要描述画面中的主要内容，并指出需要注意的细节。";
  const model = openaiConfig.visionModel;
  const prompt = [
    "你是一个实时视觉对话助手。",
    "请基于用户提供的摄像头抽帧图片回答问题。",
    "回答需要简洁、具体，只描述能从画面中合理判断的信息。",
    "如果画面信息不足，请明确说明不确定。",
    `用户问题：${question}`,
  ].join("\n");
  const responsePayload = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          {
            type: "image_url",
            image_url: {
              url: body.imageDataUrl,
              detail: "low",
            },
          },
        ],
      },
    ],
  };

  let response: Response;

  try {
    response = await fetch(`${openaiConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(responsePayload),
    });
  } catch {
    return NextResponse.json(
      { error: "无法连接视觉模型服务，请稍后重试。" },
      { status: 502 },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: await readErrorResponse(response) },
      { status: response.status },
    );
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const analysis = getMessageText(data.choices?.[0]?.message);

  if (!analysis) {
    return NextResponse.json(
      { error: "视觉模型没有返回可展示文本。" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    analysis,
    model: data.model ?? model,
    usage: data.usage ?? null,
    createdAt: new Date().toISOString(),
  });
}
