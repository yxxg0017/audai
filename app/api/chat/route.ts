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

type ChatCompletionMessage = {
  content?: string | Array<{ text?: string }>;
};

type ChatCompletionResponse = {
  choices?: Array<{
    delta?: ChatCompletionMessage;
    message?: ChatCompletionMessage;
  }>;
  model?: string;
  error?: {
    message?: string;
  };
};

const maxMessageLength = 800;
const maxVisualContextLength = 900;

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

function createJsonLine(payload: unknown) {
  return `${JSON.stringify(payload)}\n`;
}

async function readErrorResponse(response: Response) {
  const text = await response.text();

  try {
    const data = JSON.parse(text) as ChatCompletionResponse;
    return data.error?.message ?? (text || "文本模型调用失败。");
  } catch {
    return text || "文本模型调用失败。";
  }
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
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    stream: true,
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
      { error: "无法连接文本模型服务，请稍后重试。" },
      { status: 502 },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: await readErrorResponse(response) },
      { status: response.status },
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const encoder = new TextEncoder();

  if (!response.body || !contentType.includes("text/event-stream")) {
    const data = (await response.json()) as ChatCompletionResponse;
    const answer = getMessageText(data.choices?.[0]?.message);

    if (!answer) {
      return NextResponse.json(
        { error: "文本模型没有返回可展示文本。" },
        { status: 502 },
      );
    }

    return new Response(
      encoder.encode(
        [
          createJsonLine({
            type: "meta",
            model: data.model ?? openaiConfig.chatModel,
          }),
          createJsonLine({ type: "delta", text: answer }),
          createJsonLine({ type: "done" }),
        ].join(""),
      ),
      {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/x-ndjson; charset=utf-8",
        },
      },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = response.body?.getReader();

      if (!reader) {
        controller.close();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let modelSent = false;

      function enqueue(payload: unknown) {
        controller.enqueue(encoder.encode(createJsonLine(payload)));
      }

      function handleLine(line: string) {
        const trimmedLine = line.trim();

        if (!trimmedLine.startsWith("data:")) {
          return;
        }

        const dataText = trimmedLine.slice(5).trim();

        if (!dataText || dataText === "[DONE]") {
          return;
        }

        try {
          const data = JSON.parse(dataText) as ChatCompletionResponse;

          if (!modelSent) {
            enqueue({ type: "meta", model: data.model ?? openaiConfig.chatModel });
            modelSent = true;
          }

          const delta = getMessageText(data.choices?.[0]?.delta);

          if (delta) {
            enqueue({ type: "delta", text: delta });
          }
        } catch {
          // Ignore malformed upstream SSE frames.
        }
      }

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(handleLine);
      }

      if (buffer) {
        handleLine(buffer);
      }

      if (!modelSent) {
        enqueue({ type: "meta", model: openaiConfig.chatModel });
      }

      enqueue({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}
