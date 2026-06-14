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
  join(process.cwd(), "models/local-voice/ggml-large-v3-turbo.bin");
const whisperCli = process.env.LOCAL_WHISPER_CLI ?? "whisper-cli";
const sttPrompt =
  process.env.LOCAL_STT_PROMPT ??
  "以下是简体中文语音对话转写，场景是 AI 视觉对话助手。常见词包括：摄像头、麦克风、画面、视觉、上下文、桌面、屏幕、物体、文字、颜色、位置。请输出简体中文。";
const whisperBeamSize = readPositiveInteger(process.env.LOCAL_WHISPER_BEAM_SIZE, 5);
const whisperBestOf = readPositiveInteger(process.env.LOCAL_WHISPER_BEST_OF, 5);
const sttAudioFilter =
  process.env.LOCAL_STT_AUDIO_FILTER ?? "highpass=f=80,lowpass=f=8000,loudnorm";
const defaultTtsEngine = process.env.LOCAL_TTS_ENGINE ?? "say";
const piperCli = process.env.LOCAL_PIPER_CLI ?? "piper";
const piperModelPath = process.env.LOCAL_PIPER_MODEL_PATH ?? "";
const piperConfigPath = process.env.LOCAL_PIPER_CONFIG_PATH ?? "";
const maxToolWaitMs = 8000;
const pendingToolResults = new Map();
const traditionalToSimplifiedMap = new Map([
  ["畫", "画"], ["面", "面"], ["這", "这"], ["裡", "里"], ["裏", "里"],
  ["個", "个"], ["東", "东"], ["麼", "么"], ["說", "说"], ["語", "语"],
  ["聽", "听"], ["見", "见"], ["藍", "蓝"], ["綠", "绿"], ["紅", "红"],
  ["黃", "黄"], ["顏", "颜"], ["櫃", "柜"], ["門", "门"], ["掛", "挂"],
  ["著", "着"], ["幾", "几"], ["條", "条"], ["圖", "图"], ["案", "案"],
  ["頭", "头"], ["擋", "挡"], ["遮", "遮"], ["無", "无"], ["法", "法"],
  ["清", "清"], ["處", "处"], ["室", "室"], ["內", "内"], ["後", "后"],
  ["與", "与"], ["旁", "旁"], ["則", "则"], ["設", "设"], ["簾", "帘"],
  ["鋪", "铺"], ["體", "体"], ["現", "现"], ["實", "实"], ["轉", "转"],
  ["寫", "写"], ["識", "识"], ["別", "别"], ["應", "应"], ["該", "该"],
  ["問", "问"], ["題", "题"], ["視", "视"], ["覺", "觉"], ["讀", "读"],
  ["尋", "寻"], ["檢", "检"], ["測", "测"], ["狀", "状"], ["態", "态"],
  ["啟", "启"], ["動", "动"], ["發", "发"], ["關", "关"], ["開", "开"],
  ["閉", "闭"], ["傳", "传"], ["輸", "输"], ["雲", "云"], ["錄", "录"],
  ["製", "制"], ["複", "复"], ["雜", "杂"], ["優", "优"], ["質", "质"],
  ["麥", "麦"], ["風", "风"], ["攝", "摄"], ["機", "机"], ["對", "对"],
  ["話", "话"], ["較", "较"], ["輕", "轻"], ["線", "线"], ["臺", "台"],
  ["檔", "档"], ["單", "单"], ["雙", "双"], ["歲", "岁"], ["鏡", "镜"],
  ["牆", "墙"], ["臟", "脏"], ["紙", "纸"], ["杯", "杯"], ["圓", "圆"],
  ["錢", "钱"], ["鐘", "钟"], ["書", "书"], ["標", "标"], ["籤", "签"],
  ["碼", "码"], ["嗎", "吗"], ["陰", "阴"], ["陽", "阳"], ["電", "电"],
  ["腦", "脑"], ["燈", "灯"], ["滾", "滚"], ["換", "换"], ["庫", "库"],
  ["櫥", "橱"], ["臉", "脸"], ["邊", "边"], ["帶", "带"], ["餘", "余"],
]);

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

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toSimplifiedChinese(text) {
  return text
    .split("")
    .map((char) => traditionalToSimplifiedMap.get(char) ?? char)
    .join("");
}

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
  const [modelReady, ffmpegReady, whisperReady, sayReady, piperReady, piperModelReady] = await Promise.all([
    canReadFile(modelPath),
    canRunCommand("ffmpeg", ["-version"]),
    canRunCommand(whisperCli, ["--help"]),
    canRunCommand("say", ["-v", "?"]),
    canRunCommand(piperCli, ["--help"]),
    piperModelPath ? canReadFile(piperModelPath) : Promise.resolve(false),
  ]);

  const ttsEngine = defaultTtsEngine === "piper" ? "piper" : "say";

  const checks = {
    ffmpeg: ffmpegReady,
    model: modelReady,
    say: ttsEngine === "say" ? sayReady : true,
    piper: ttsEngine === "piper" ? piperReady : true,
    piperModel: ttsEngine === "piper" ? piperModelReady : true,
    whisper: whisperReady,
  };

  return {
    checks,
    host,
    modelPath,
    ok: Object.values(checks).every(Boolean),
    port,
    service: "audai-local-voice-node",
    sttAudioFilter,
    sttPromptEnabled: Boolean(sttPrompt.trim()),
    tts: {
      engine: ttsEngine,
      piperCli,
      piperModelPath,
    },
    whisperCli,
    whisperDecode: {
      beamSize: whisperBeamSize,
      bestOf: whisperBestOf,
    },
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
    const ffmpegArgs = [
      "-y",
      "-i",
      inputPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
    ];
    if (sttAudioFilter.trim()) {
      ffmpegArgs.push("-af", sttAudioFilter);
    }
    ffmpegArgs.push(wavPath);
    await runCommand("ffmpeg", ffmpegArgs);

    const whisperArgs = [
      "-m",
      modelPath,
      "-f",
      wavPath,
      "-l",
      "zh",
      "-bs",
      String(whisperBeamSize),
      "-bo",
      String(whisperBestOf),
      "-nt",
      "-np",
    ];
    if (sttPrompt.trim()) {
      whisperArgs.push("--prompt", sttPrompt, "--carry-initial-prompt");
    }

    const { output } = await runCommand(whisperCli, whisperArgs);
    return toSimplifiedChinese(output);
  } finally {
    void rm(inputPath, { force: true });
    void rm(wavPath, { force: true });
  }
}

async function synthesizeSpeechWithSay(text, voice) {
  const dir = join(tmpdir(), "audai-local-voice");
  await mkdir(dir, { recursive: true });
  const id = randomUUID();
  const aiffPath = join(dir, `${id}.aiff`);
  const wavPath = join(dir, `${id}.wav`);
  const args = voice ? ["-v", voice, "-o", aiffPath, text] : ["-o", aiffPath, text];
  try {
    await runCommand("say", args);
    await runCommand("ffmpeg", [
      "-y",
      "-i",
      aiffPath,
      "-ar",
      "24000",
      "-ac",
      "1",
      "-f",
      "wav",
      wavPath,
    ]);
    const audio = await readFile(wavPath);
    return {
      audioBase64: audio.toString("base64"),
      mimeType: "audio/wav",
    };
  } finally {
    void rm(aiffPath, { force: true });
    void rm(wavPath, { force: true });
  }
}

async function synthesizeSpeechWithPiper(text, voice) {
  const dir = join(tmpdir(), "audai-local-voice");
  await mkdir(dir, { recursive: true });
  const wavPath = join(dir, `${randomUUID()}.wav`);
  const model = voice || piperModelPath;

  if (!model) {
    throw new Error("已选择 Piper TTS，但未配置 LOCAL_PIPER_MODEL_PATH 或本地 TTS 声音模型路径。");
  }

  const args = ["--model", model, "--output_file", wavPath];
  if (piperConfigPath) {
    args.push("--config", piperConfigPath);
  }

  await new Promise((resolve, reject) => {
    const child = spawn(piperCli, args);
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `${piperCli} exited with ${code}`));
    });
    child.stdin.end(text);
  });

  try {
    const audio = await readFile(wavPath);
    return {
      audioBase64: audio.toString("base64"),
      mimeType: "audio/wav",
    };
  } finally {
    void rm(wavPath, { force: true });
  }
}

async function synthesizeSpeech(text, config) {
  const engine = config.localTtsEngine === "piper" || defaultTtsEngine === "piper"
    ? "piper"
    : "say";

  if (engine === "piper") {
    return synthesizeSpeechWithPiper(text, config.localTtsVoice);
  }

  return synthesizeSpeechWithSay(text, config.localTtsVoice);
}

function detectVisualTool(text) {
  const normalized = text.trim().toLowerCase();
  return visualTools.find((tool) =>
    tool.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())),
  );
}

function normalizeModelName(model = "") {
  return model.replace(/^\[[^\]]+\]/, "");
}

function isProbablyVisionModel(model = "") {
  const normalized = normalizeModelName(model).toLowerCase();
  return [
    "4o",
    "4.1",
    "vision",
    "vl",
    "gemini",
    "qwen-vl",
    "glm-4v",
  ].some((keyword) => normalized.includes(keyword));
}

function resolveVisionModel(config) {
  const visionModel = String(config.visionModel ?? "").trim();
  const chatModel = String(config.chatModel ?? "").trim();

  if (isProbablyVisionModel(visionModel)) {
    return visionModel;
  }

  if (isProbablyVisionModel(chatModel)) {
    return chatModel;
  }

  if (visionModel.startsWith("[") || chatModel.startsWith("[")) {
    return "[按次]gpt-4o";
  }

  return "gpt-4o";
}

function estimateDataUrlBytes(dataUrl) {
  const base64 = String(dataUrl).split(",")[1] ?? "";
  return Math.round((base64.length * 3) / 4);
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

function extractDelta(payload) {
  const content = payload.choices?.[0]?.delta?.content;
  if (typeof content === "string") {
    return toSimplifiedChinese(content);
  }
  if (Array.isArray(content)) {
    return toSimplifiedChinese(content.map((item) => item.text ?? "").join(""));
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

async function streamChat({ config, imageDataUrl, send, text, timings, turnId, visualTool }) {
  if (!config.apiKey) {
    throw new Error("未配置 API Key，无法调用聊天模型。请先在前端保存 OpenAI-compatible 配置。");
  }

  const hasVisualInput = Boolean(imageDataUrl && visualTool);
  const model = hasVisualInput ? resolveVisionModel(config) : config.chatModel;
  const promptText = [
    "你是一个低延迟 AI 视觉对话助手。",
    "请用自然简体中文回答，默认不超过 3 句话。",
    hasVisualInput
      ? [
          "当前用户问题命中了视觉工具，摄像头抽帧已经作为图片输入。",
          "你应当基于随消息提供的 image_url 图片作答，不要声称没有收到图像，除非图片本身不可读取。",
          visualTool.prompt,
          "请直接结合图片回答；看不清或无法判断时要明确说明不确定。",
        ].join("\n")
      : "",
    `用户问题：${text}`,
  ].filter(Boolean).join("\n");
  const content = hasVisualInput
    ? [
        { type: "text", text: promptText },
        {
          image_url: { detail: "low", url: imageDataUrl },
          type: "image_url",
        },
      ]
    : promptText;
  const messages = [
    {
      content,
      role: "user",
    },
  ];
  send("metric", {
    name: "llm_request_start",
    ms: Math.round(performance.now() - timings.startedAt),
    model,
    turnId,
  });
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    body: JSON.stringify({
      max_tokens: hasVisualInput ? 220 : 300,
      messages,
      model,
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
    throw new Error(
      `文本模型调用失败，模型 ${model}：${payload.error?.message ?? "未知错误。"}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let speechBuffer = "";
  let firstTokenSent = false;
  let ttsStarted = false;
  let ttsQueue = Promise.resolve();

  function queueSpeakSegment(segment) {
    if (!ttsStarted) {
      send("tts.start", { turnId });
      ttsStarted = true;
    }
    send("tts.sentence_start", { text: segment, turnId });
    ttsQueue = ttsQueue.then(async () => {
      const audioStartedAt = performance.now();
      const audio = await synthesizeSpeech(segment, config);
      if (!timings.firstAudioAt) {
        timings.firstAudioAt = performance.now();
        send("metric", {
          name: "tts_first_audio",
          ms: Math.round(timings.firstAudioAt - timings.startedAt),
          synthMs: Math.round(timings.firstAudioAt - audioStartedAt),
          turnId,
        });
      }
      send("tts.audio", { ...audio, text: segment, turnId });
    });
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
    if (!firstTokenSent) {
      firstTokenSent = true;
      timings.firstTokenAt = performance.now();
      send("metric", {
        name: "llm_first_token",
        ms: Math.round(timings.firstTokenAt - timings.startedAt),
        model,
        turnId,
      });
    }
    send("llm.delta", { text: delta, turnId });
    speechBuffer += delta;
    const { rest, segments } = extractSpeakableSegments(speechBuffer);
    speechBuffer = rest;
    for (const segment of segments) {
      queueSpeakSegment(segment);
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
    queueSpeakSegment(speechBuffer.trim());
  }
  await ttsQueue;
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
  const timings = {
    firstAudioAt: 0,
    firstTokenAt: 0,
    startedAt: performance.now(),
  };

  try {
    if (!(audio instanceof File)) {
      throw new Error("缺少音频文件。");
    }
    const text = await transcribeAudio(audio);
    send("metric", {
      name: "stt_final",
      ms: Math.round(performance.now() - timings.startedAt),
      turnId,
    });
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

    let imageDataUrl = "";
    const visualTool = detectVisualTool(text);
    if (visualTool) {
      const toolStartedAt = performance.now();
      send("tool.call", {
        keywords: visualTool.keywords,
        name: visualTool.name,
        reason: "用户语音命中视觉关键词",
        turnId,
      });
      const result = await waitForToolResult(turnId);
      send("metric", {
        name: "vision_wait",
        ms: Math.round(performance.now() - toolStartedAt),
        turnId,
      });
      if (result?.imageDataUrl) {
        imageDataUrl = result.imageDataUrl;
        const visionModel = resolveVisionModel(config);
        send("tool.result", {
          name: visualTool.name,
          summary: `已接收当前画面（约 ${estimateDataUrlBytes(imageDataUrl)} bytes），将使用 ${visionModel} 进行多模态流式回答。`,
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
      await streamChat({ config, imageDataUrl, send, text, timings, turnId, visualTool });
    }
    send("metric", {
      name: "total",
      ms: Math.round(performance.now() - timings.startedAt),
      turnId,
    });
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
