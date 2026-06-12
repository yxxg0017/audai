import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "../../lib/rate-limit";

type VisionRequestBody = {
  imageDataUrl?: unknown;
  question?: unknown;
};

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
  usage?: unknown;
  error?: {
    message?: string;
  };
};

const MAX_IMAGE_DATA_URL_LENGTH = 2_000_000;
const MAX_QUESTION_LENGTH = 500;
const imageDataUrlPattern = /^data:image\/(?:jpeg|jpg|png|webp);base64,/;

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

function getVisionModel() {
  return process.env.OPENAI_VISION_MODEL?.trim() || "gpt-5.5";
}

function isGpt5Model(model: string) {
  return model.startsWith("gpt-5");
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 OPENAI_API_KEY，无法进行视觉分析。" },
      { status: 503 },
    );
  }

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

  const question =
    typeof body.question === "string" && body.question.trim()
      ? body.question.trim().slice(0, MAX_QUESTION_LENGTH)
      : "请用中文简要描述画面中的主要内容，并指出需要注意的细节。";
  const model = getVisionModel();
  const prompt = [
    "你是一个实时视觉对话助手。",
    "请基于用户提供的摄像头抽帧图片回答问题。",
    "回答需要简洁、具体，只描述能从画面中合理判断的信息。",
    "如果画面信息不足，请明确说明不确定。",
    `用户问题：${question}`,
  ].join("\n");
  const responsePayload = {
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          {
            type: "input_image",
            image_url: body.imageDataUrl,
            detail: "low",
          },
        ],
      },
    ],
    max_output_tokens: 360,
    ...(isGpt5Model(model)
      ? {
          reasoning: { effort: "none" },
          text: { verbosity: "low" },
        }
      : {}),
  };

  let response: Response;

  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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

  const data = (await response.json()) as OpenAIResponse;

  if (!response.ok) {
    return NextResponse.json(
      { error: data.error?.message ?? "视觉模型调用失败。" },
      { status: response.status },
    );
  }

  const analysis = getOutputText(data);

  if (!analysis) {
    return NextResponse.json(
      { error: "视觉模型没有返回可展示文本。" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    analysis,
    model,
    usage: data.usage ?? null,
    createdAt: new Date().toISOString(),
  });
}
