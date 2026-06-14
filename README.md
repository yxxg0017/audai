# AI 视觉对话助手

AI 视觉对话助手是一款基于浏览器摄像头、麦克风和多模态模型的实时对话应用。用户可以通过文字或语音提问，应用会按需采集当前画面，把视觉上下文作为工具结果注入对话，并以流式文字和语音返回回答。

项目默认使用“本地语音流水线”：前端负责摄像头、麦克风、VAD 和音频分片采集；本地 Node 语音服务负责编排 STT、LLM、TTS 与视觉 tool；前端通过 SSE 接收转写、模型增量文本、音频片段和耗时指标。设置中也保留 OpenAI Realtime 模式，适合需要 WebRTC 实时语音的场景。

## Demo 视频

本项目已录制完整的功能演示视频，包含多模态视觉识别与语音打断交互等核心功能。

视频已上传至 Bilibili，**无需下载、无需登录账号**即可在线观看：

[查看项目 Demo 视频](https://www.bilibili.com/video/BV139JP6HERV/)

## 功能特性

- 首次进入配置页：保存 API Key、Base URL、模型和语音参数到浏览器本地配置。
- 摄像头与麦克风采集：支持实时视频预览、麦克风电平显示和前后摄像头切换。
- 语音活动检测：基于 Web Audio 的 VAD 识别一句话开始和结束，并保留预录缓冲，减少开头音节丢失。
- 实时语音流水线：音频 turn 通过 HTTP POST 上传到本地语音服务，结果通过 SSE 流式返回。
- 本地 STT/TTS：默认支持 whisper.cpp 转写和 macOS `say` 合成，也可配置 Piper 本地声线。
- 流式模型回复：文本模型按 token 增量输出，TTS 可按句并行合成，降低听感延迟。
- 视觉 tool 调用：当用户询问画面、物体、文字、颜色或位置时，自动抓取当前压缩帧并注入多模态回答。
- 视觉成本优化：只上传压缩后的单帧图片，不传连续视频流，并复用短时间内的最近帧。
- 状态与日志面板：顶部菜单展示媒体状态、STT 状态、SSE 事件、耗时指标和成本指标。
- 手机局域网访问：前端通过同源代理访问本地语音服务，避免手机直接访问 `127.0.0.1` 和 HTTPS 混合内容问题。

## 技术栈

- Next.js 16
- React 19
- TypeScript
- Web Audio API
- MediaRecorder / getUserMedia
- Server-Sent Events
- OpenAI 兼容 Chat Completions / Vision API
- whisper.cpp
- macOS `say` 或 Piper

## 项目结构

```text
app/
  api/
    chat/                 文本模型流式接口
    vision/               视觉分析接口
    realtime/session/     Realtime 临时会话接口
    local-voice/          本地语音服务同源代理
  components/
    app-gate.tsx          首次配置与应用入口
    conversation-workspace.tsx
  lib/
    use-local-media.ts    摄像头、麦克风和前后摄像头切换
    use-voice-pipeline.ts 本地语音流水线客户端
    use-realtime-audio.ts Realtime WebRTC 客户端
    frame-capture.ts      视频抽帧、缩放和压缩
    client-config.ts      浏览器配置读写
scripts/
  local_voice_server.mjs  本地 STT/LLM/TTS 编排服务
  setup_local_voice.sh    whisper.cpp 与模型安装脚本
docs/
  design.md              项目设计文档
```

## 环境要求

- Node.js 22 或更高版本
- npm
- ffmpeg
- macOS 推荐安装 Xcode Command Line Tools
- 本地 STT 需要 whisper.cpp 的 `whisper-cli`
- 可选：Piper，用于更自然的本地 TTS 声线

## 快速启动

安装依赖：

```bash
npm install
```

复制环境变量示例：

```bash
cp .env.example .env.local
```

启动 Next.js：

```bash
npm run dev
```

打开浏览器访问：

```text
http://localhost:3000
```

首次进入会显示配置页。填写 OpenAI 兼容 API Key、Base URL 和模型后保存，后续同一浏览器会自动进入主界面。配置保存在当前浏览器的 `localStorage`，适合本地开发和演示，不适合作为生产级密钥托管方案。

## 环境变量

可以在 `.env.local` 中配置服务端备用值：

```bash
OPENAI_API_KEY=你的 API Key
OPENAI_CHAT_MODEL=gpt-4o
OPENAI_VISION_MODEL=gpt-4o
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VOICE=marin
OPENAI_REALTIME_TRANSCRIPTION_MODEL=whisper-1

LOCAL_VOICE_URL=/api/local-voice/turn
LOCAL_VOICE_PROXY_TARGET=http://127.0.0.1:8766
LOCAL_STT_MODEL_PATH=models/local-voice/ggml-large-v3-turbo.bin
LOCAL_STT_PROMPT=以下是简体中文语音对话转写，场景是 AI 视觉对话助手。请输出简体中文。
LOCAL_WHISPER_BEAM_SIZE=5
LOCAL_WHISPER_BEST_OF=5
LOCAL_STT_AUDIO_FILTER=highpass=f=80,lowpass=f=8000,loudnorm
LOCAL_TTS_ENGINE=say
LOCAL_TTS_VOICE=
LOCAL_PIPER_CLI=piper
LOCAL_PIPER_MODEL_PATH=/path/to/voice.onnx
```

前端配置页填写的 API Key、Base URL 和模型会优先随请求发送到服务端 API Route；没有前端配置时，服务端再回退到 `.env.local`。

## 本地语音服务

项目提供本机开发用语音服务，默认链路如下：

```text
麦克风音频
  -> 前端 VAD 判断一句话边界
  -> HTTP POST 上传音频 turn
  -> whisper.cpp 本地 STT
  -> OpenAI 兼容 LLM 流式回复
  -> 本地 TTS 合成音频
  -> SSE 返回文本、音频和指标
```

安装本地语音依赖和默认模型：

```bash
bash scripts/setup_local_voice.sh
```

默认模型是 `ggml-large-v3-turbo.bin`，更偏向中文识别准确率。如果本机推理速度不够，可以选择更小模型：

```bash
bash scripts/setup_local_voice.sh small
LOCAL_STT_MODEL_PATH=models/local-voice/ggml-small.bin npm run voice:local
```

可选模型：

- `base`
- `small`
- `medium`
- `large-v3-turbo`

启动本地语音服务：

```bash
npm run voice:local
```

健康检查：

```bash
curl http://127.0.0.1:8766/health
```

如果返回 `ok: true`，前端设置里的“本地语音会话地址”保持默认 `/api/local-voice/turn` 即可。Next.js 会通过同源 API 代理到本机语音服务。

## TTS 声线配置

默认 TTS 引擎是 macOS `say`，适合快速验证：

```bash
LOCAL_TTS_ENGINE=say
LOCAL_TTS_VOICE=Tingting
```

如果需要更自然的离线声线，可以使用 Piper：

```bash
LOCAL_TTS_ENGINE=piper
LOCAL_PIPER_CLI=piper
LOCAL_PIPER_MODEL_PATH=/path/to/voice.onnx
```

也可以在前端顶部“设置”菜单中选择本地 TTS 引擎，并填写本地 TTS 声音或 Piper `.onnx` 模型路径。

## 手机访问与 HTTPS

摄像头和麦克风需要浏览器安全上下文：

- 本机开发优先使用 `http://localhost:3000`。
- 手机访问局域网地址时，建议给 Next.js 配置 HTTPS，或使用受信任的本地证书代理。
- 推荐保留默认 `/api/local-voice/turn`，让手机只访问 Next.js 同源接口，再由 Next.js 服务端代理到 Mac 上的本地语音服务。

如果 Next.js 和本地语音服务不在同一台机器上，可以设置：

```bash
LOCAL_VOICE_PROXY_TARGET=http://语音服务所在机器IP:8766
npm run dev
```

## 主要接口

本地语音服务：

- `GET /health`：检查 ffmpeg、whisper-cli、模型文件和 TTS 引擎。
- `POST /voice/turn`：接收 `multipart/form-data` 的 `audio`、`config`、`sessionId`、`turnId`，返回 `text/event-stream`。
- `POST /voice/tool-result`：前端收到视觉 tool 请求后回传当前压缩帧。

SSE 事件：

- `stt.final`：最终转写文本。
- `tool.call`：请求前端执行视觉 tool。
- `tool.result`：视觉 tool 回传状态。
- `metric`：STT、视觉等待、首 token、首音频和总耗时指标。
- `llm.delta`：模型流式文本片段。
- `tts.start` / `tts.sentence_start` / `tts.audio` / `tts.stop`：TTS 合成与播放事件。
- `done`：本轮完成。
- `error`：本轮异常。

## 使用流程

1. 启动 Next.js：`npm run dev`。
2. 启动本地语音服务：`npm run voice:local`。
3. 打开 `http://localhost:3000`。
4. 在配置页填写 API Key、Base URL 和模型并保存。
5. 授权摄像头和麦克风。
6. 点击“开始语音”，直接说话。
7. 在“实时转写”区域确认 STT 文本、turnId、音频大小和耗时指标。
8. 询问“我面前有什么”“画面里有哪些文字”等问题，确认视觉 tool 自动抓帧并生成多模态回答。
9. 需要切换手机后置摄像头时，点击视频控制区的前后摄像头切换按钮。

## 成本与延迟优化

- 视觉请求只上传压缩单帧，不上传连续视频流。
- 默认压缩图片宽度和质量，减少视觉模型输入体积。
- 视觉 tool 会复用短时间内的最近压缩帧，避免重复抽帧。
- 模型回复使用流式输出，前端尽早显示首 token。
- TTS 按句触发，减少等待完整回答后再播放的延迟。
- 本地 STT/TTS 可降低云端语音调用成本。
- 前端状态面板展示 STT、视觉等待、首 token、首音频和总耗时，便于定位瓶颈。

## 常用命令

```bash
npm run dev
npm run voice:local
npm run lint
npm run typecheck
npm run build
```

## 设计文档

更完整的架构、用户故事和成本控制说明见 [docs/design.md](docs/design.md)。
