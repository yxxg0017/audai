import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "../../lib/rate-limit";
import {
  getOpenAIRequestConfig,
  missingApiKeyResponse,
  type ApiConfigBody,
} from "../../lib/request-config";

type ModelsRequestBody = ApiConfigBody;

type OpenAIModelsResponse = {
  data?: Array<{
    id?: string;
  }>;
  error?: {
    message?: string;
  };
};

const chatPatterns = [
  /^gpt-5/i,
  /^gpt-4\.1/i,
  /^gpt-4o/i,
  /^o[34]/i,
  /deepseek-chat/i,
  /qwen.*(chat|plus|turbo|max)/i,
  /glm/i,
];
const visionPatterns = [
  /^gpt-5/i,
  /^gpt-4\.1/i,
  /^gpt-4o/i,
  /vision/i,
  /vl/i,
  /gemini/i,
  /qwen.*vl/i,
];
const realtimePatterns = [/realtime/i];
const transcriptionPatterns = [/transcribe/i, /whisper/i, /stt/i];

function pickModel(
  models: string[],
  currentModel: string,
  patterns: RegExp[],
  fallbackPatterns: RegExp[] = [],
) {
  if (models.includes(currentModel)) {
    return currentModel;
  }

  const byPrimaryPattern = models.find((model) =>
    patterns.some((pattern) => pattern.test(model)),
  );

  if (byPrimaryPattern) {
    return byPrimaryPattern;
  }

  const byFallbackPattern = models.find((model) =>
    fallbackPatterns.some((pattern) => pattern.test(model)),
  );

  if (byFallbackPattern) {
    return byFallbackPattern;
  }

  return currentModel;
}

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(request, {
    namespace: "models",
    maxRequests: 20,
    windowMs: 60 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  let body: ModelsRequestBody;

  try {
    body = (await request.json()) as ModelsRequestBody;
  } catch {
    return NextResponse.json({ error: "请求体不是有效 JSON。" }, { status: 400 });
  }

  const openaiConfig = getOpenAIRequestConfig(body);

  if (!openaiConfig.apiKey) {
    return missingApiKeyResponse("检测可用模型");
  }

  let response: Response;

  try {
    response = await fetch(`${openaiConfig.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${openaiConfig.apiKey}`,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "无法连接模型列表服务，请检查 Base URL。" },
      { status: 502 },
    );
  }

  const data = (await response.json()) as OpenAIModelsResponse;

  if (!response.ok) {
    return NextResponse.json(
      { error: data.error?.message ?? "模型列表读取失败。" },
      { status: response.status },
    );
  }

  const models = (data.data ?? [])
    .map((model) => model.id?.trim())
    .filter((model): model is string => Boolean(model))
    .sort((left, right) => left.localeCompare(right));

  if (models.length === 0) {
    return NextResponse.json(
      { error: "模型列表为空，无法自动选择模型。" },
      { status: 502 },
    );
  }

  const textFallbackPatterns = chatPatterns.filter(
    (pattern) => !/vision|vl/.test(pattern.source),
  );

  return NextResponse.json({
    models,
    suggested: {
      chatModel: pickModel(models, openaiConfig.chatModel, chatPatterns),
      visionModel: pickModel(
        models,
        openaiConfig.visionModel,
        visionPatterns,
        textFallbackPatterns,
      ),
      realtimeModel: pickModel(
        models,
        openaiConfig.realtimeModel,
        realtimePatterns,
      ),
      realtimeTranscriptionModel: pickModel(
        models,
        openaiConfig.realtimeTranscriptionModel,
        transcriptionPatterns,
      ),
    },
  });
}
