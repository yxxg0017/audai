#!/usr/bin/env node
import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const host = process.env.LOCAL_VOICE_HOST ?? "127.0.0.1";
const port = Number(process.env.LOCAL_VOICE_NODE_PORT ?? "8766");
const modelPath =
  process.env.LOCAL_STT_MODEL_PATH ??
  join(process.cwd(), "models/local-voice/ggml-base.bin");
const whisperCli = process.env.LOCAL_WHISPER_CLI ?? "whisper-cli";
const maxToolWaitMs = 8000;
const pendingToolResults = new Map();

const visualTools = [
  {
    name: "analyze_current_frame",
    keywords: ["画面", "看到", "看见", "镜头", "摄像头", "面前"],
    prompt: "请简要描述当前画面中与用户问题相关的事实。",
  },
  {
    name: "identify_object",
    keywords: ["这是什么", "是什么东西", "手里", "桌上"],
    prompt: "请识别画面中的目标物体，并说明可见依据。",
  },
  {
    name: "read_text",
    keywords: ["读一下", "文字", "上面写了什么", "牌子"],
    prompt: "请读取画面中可见文字，无法确定时说明不确定。",
  },
  {
    name: "describe_scene",
    keywords: ["有什么", "描述", "环境", "周围"],
    prompt: "请概括画面场景、人物、物体和需要注意的细节。",
  },
  {
    name: "locate_object",
    keywords: ["在哪里", "找一下", "有没有"],
    prompt: "请判断用户提到的对象是否在画面中，并描述位置。",
  },
];

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function parseFormData(request, body) {
  const formRequest = new Request(`http://${host}${request.url}`, {
    body,
    headers: request.headers,
    method: request.method,
  });
  return formRequest.formData();
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const error = Buffer.concat(stderr).toString("utf8").trim();
      if (code === 0) {
        resolve({ output, error });
        return;
      }
      reject(new Error(error || `${command} exited with ${code}`));
    });
  });
}

async function canReadFile(filePath) {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function canRunCommand(command, args) {
  try {
    await runCommand(command, args);
    return true;
  } catch {
    return false;
  }
}

async function readHealthStatus() {
  const [modelReady, ffmpegReady, whisperReady, sayReady] = await Promise.all([
    canReadFile(modelPath),
    canRunCommand("ffmpeg", ["-version"]),
    canRunCommand(whisperCli, ["--help"]),
    canRunCommand("say", ["-v", "?"]),
  ]);

  const checks = {
    ffmpeg: ffmpegReady,
    model: modelReady,
    say: sayReady,
    whisper: whisperReady,
  };

  return {
    checks,
    host,
    modelPath,
    ok: Object.values(checks).every(Boolean),
    port,
    service: "audai-local-voice-node",
    whisperCli,
  };
}

async function writeFileFromBlob(blob, suffix) {
  const dir = join(tmpdir(), "audai-local-voice");
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${randomUUID()}${suffix}`);
  await writeFile(filePath, Buffer.from(await blob.arrayBuffer()));
  return filePath;
}

async function transcribeAudio(audio) {
  if (!(await canReadFile(modelPath))) {
    throw new Error(`本地 STT 模型不存在或不可读：${modelPath}。请先运行 bash scripts/setup_local_voice.sh。`);
  }

  const inputPath = await writeFileFromBlob(audio, ".webm");
  const wavPath = inputPath.replace(/\.webm$/, ".wav");
  try {
    await runCommand("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      wavPath,
    ]);
    const { output } = await runCommand(whisperCli, [
      "-m",
      modelPath,
      "-f",
      wavPath,
      "-l",
      "zh",
      "-nt",
      "-np",
    ]);
    return output;
  } finally {
    void rm(inputPath, { force: true });
    void rm(wavPath, { force: true });
  }
}

async function synthesizeSpeech(text, voice) {
  const dir = join(tmpdir(), "audai-local-voice");
  await mkdir(dir, { recursive: true });
  const outputPath = join(dir, `${randomUUID()}.aiff`);
  const args = voice ? ["-v", voice, "-o", outputPath, text] : ["-o", outputPath, text];
  await runCommand("say", args);
  const audio = await readFile(outputPath);
  void rm(outputPath, { force: true });
  return {
    audioBase64: audio.toString("base64"),
    mimeType: "audio/aiff",
  };
}

function detectVisualTool(text) {
  const normalized = text.trim().toLowerCase();
  return visualTools.find((tool) =>
    tool.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())),
  );
}

function createSse(response) {
  response.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
  });
  return (event, data) => {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}

function waitForToolResult(turnId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingToolResults.delete(turnId);
      resolve(null);
    }, maxToolWaitMs);
    pendingToolResults.set(turnId, (payload) => {
      clearTimeout(timeout);
      pendingToolResults.delete(turnId);
      resolve(payload);
    });
  });
}

async function analyzeImage({ config, imageDataUrl, question, tool }) {
  if (!config.apiKey) {
    return "未配置 API Key，无法进行视觉分析。";
  }
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    body: JSON.stringify({
      messages: [
        {
          content: [
            {
              text: [
                "你是视觉对话工具。",
                tool.prompt,
                `用户问题：${question}`,
                "回答控制在 120 字以内，只描述能从画面确认的事实。",
              ].join("\n"),
              type: "text",
            },
            {
              image_url: { detail: "low", url: imageDataUrl },
              type: "image_url",
            },
          ],
          role: "user",
        },
      ],
      model: config.visionModel,
    }),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "视觉工具调用失败。");
  }
  return payload.choices?.[0]?.message?.content?.trim() ?? "";
}

function extractDelta(payload) {
  const content = payload.choices?.[0]?.delta?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => item.text ?? "").join("");
  }
  return "";
}

function extractSpeakableSegments(text) {
  const segments = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if ("。！？!?；;\n".includes(text[index])) {
      const segment = text.slice(start, index + 1).trim();
      if (segment) {
        segments.push(segment);
      }
      start = index + 1;
    }
  }
  return { rest: text.slice(start), segments };
}

async function streamChat({ config, send, text, turnId, visualSummary }) {
  if (!config.apiKey) {
    throw new Error("未配置 API Key，无法调用聊天模型。请先在前端保存 OpenAI-compatible 配置。");
  }

  const messages = [
    {
      content: [
        "你是一个低延迟 AI 视觉对话助手。",
        "请用自然中文回答，默认不超过 3 句话。",
        visualSummary ? `视觉工具结果：${visualSummary}` : "",
        `用户问题：${text}`,
      ].filter(Boolean).join("\n"),
      role: "user",
    },
  ];
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    body: JSON.stringify({
      messages,
      model: config.chatModel,
      stream: true,
    }),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error?.message ?? "文本模型调用失败。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let speechBuffer = "";
  let ttsStarted = false;

  async function speakSegment(segment) {
    if (!ttsStarted) {
      send("tts.start", { turnId });
      ttsStarted = true;
    }
    send("tts.sentence_start", { text: segment, turnId });
    const audio = await synthesizeSpeech(segment, config.localTtsVoice);
    send("tts.audio", { ...audio, text: segment, turnId });
  }

  async function handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      return;
    }
    const dataText = trimmed.slice(5).trim();
    if (!dataText || dataText === "[DONE]") {
      return;
    }
    const payload = JSON.parse(dataText);
    const delta = extractDelta(payload);
    if (!delta) {
      return;
    }
    send("llm.delta", { text: delta, turnId });
    speechBuffer += delta;
    const { rest, segments } = extractSpeakableSegments(speechBuffer);
    speechBuffer = rest;
    for (const segment of segments) {
      await speakSegment(segment);
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
    for (const line of lines) {
      await handleLine(line);
    }
  }
  if (buffer) {
    await handleLine(buffer);
  }
  if (speechBuffer.trim()) {
    await speakSegment(speechBuffer.trim());
  }
  if (ttsStarted) {
    send("tts.stop", { turnId });
  }
}

async function handleVoiceTurn(request, response) {
  const formData = await parseFormData(request, await readRequestBody(request));
  const audio = formData.get("audio");
  const turnId = String(formData.get("turnId") ?? randomUUID());
  const sessionId = String(formData.get("sessionId") ?? "default");
  const config = JSON.parse(String(formData.get("config") ?? "{}"));
  const send = createSse(response);

  try {
    if (!(audio instanceof File)) {
      throw new Error("缺少音频文件。");
    }
    const text = await transcribeAudio(audio);
    send("stt.final", { sessionId, text, turnId });

    if (!text.trim()) {
      send("done", {
        reason: "empty_transcript",
        sessionId,
        turnId,
      });
      response.end();
      return;
    }

    let visualSummary = "";
    const visualTool = detectVisualTool(text);
    if (visualTool) {
      send("tool.call", {
        keywords: visualTool.keywords,
        name: visualTool.name,
        reason: "用户语音命中视觉关键词",
        turnId,
      });
      const result = await waitForToolResult(turnId);
      if (result?.imageDataUrl) {
        visualSummary = await analyzeImage({
          config,
          imageDataUrl: result.imageDataUrl,
          question: text,
          tool: visualTool,
        });
        send("tool.result", {
          name: visualTool.name,
          summary: visualSummary,
          turnId,
        });
      } else {
        send("tool.result", {
          name: visualTool.name,
          summary: "前端未能提供当前画面，已跳过视觉上下文。",
          turnId,
        });
      }
    }

    if (text) {
      await streamChat({ config, send, text, turnId, visualSummary });
    }
    send("done", { sessionId, turnId });
    response.end();
  } catch (error) {
    send("error", {
      message: error instanceof Error ? error.message : "本地语音会话失败。",
      recoverable: true,
      turnId,
    });
    response.end();
  }
}

async function handleToolResult(request, response) {
  const body = JSON.parse((await readRequestBody(request)).toString("utf8") || "{}");
  const turnId = String(body.turnId ?? "");
  const resolve = pendingToolResults.get(turnId);
  if (!resolve) {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "turn is not waiting for a tool result" }));
    return;
  }
  resolve(body);
  response.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify({ ok: true }));
}

const server = createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Origin": "*",
    });
    response.end();
    return;
  }
  void (async () => {
    if (request.method === "GET" && request.url === "/health") {
      const health = await readHealthStatus();
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify(health));
      return;
    }
    if (request.method === "POST" && request.url === "/voice/turn") {
      await handleVoiceTurn(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/voice/tool-result") {
      await handleToolResult(request, response);
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  })().catch((error) => {
    response.writeHead(500, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "server error" }));
  });
});

server.listen(port, host, () => {
  console.log(`Audai local voice node service: http://${host}:${port}`);
});
