# AI 视觉对话助手

本仓库用于完成 3 天议题实战项目：开发一款能调用摄像头和麦克风的 AI 对话应用，让 AI 可以看到实时画面、听到用户语音，并给出合适回应。

当前仓库处于私有开发阶段；最终提交前需要按活动要求确认仓库可访问性、README、设计文档和 demo 视频无误。

## 提交状态

- 代码仓库：开发期间可保持私有，提交截止后需改为公开或确保评委可访问。
- demo 视频：待录制，最终链接需补充到 README。
- 设计文档：[docs/design.md](docs/design.md)，已补全用户故事、技术方案和成本控制策略。
- 提交方式：所有新增功能必须通过 PR 合并，避免最后一天一次性导入代码。

## 项目目标

应用需要实现：

- 在用户授权后打开摄像头和麦克风。
- 采集摄像头画面，让 AI 理解当前视觉内容。
- 采集用户语音，让 AI 理解用户问题或指令。
- 以自然、低延迟的方式返回文字或语音回应。
- 综合考虑视觉理解准确性、语音交互流畅度，以及端云协同下的运营成本控制。

## 已实现功能

- 本地摄像头和麦克风授权采集。
- 摄像头预览和麦克风输入电平展示。
- 本地摄像头抽帧、缩放和压缩。
- 多模态视觉分析 API。
- Realtime 临时会话 API。
- WebRTC 实时语音输入和模型语音输出。
- Realtime 事件解析、语音转写和 AI 回复转写。
- AI 回复中的用户插话打断。
- 浏览器语音流水线模式：SpeechRecognition 转写、文本模型回复、SpeechSynthesis 播放。
- 语音视觉意图识别和当前画面上下文注入。
- 视觉摘要 60 秒缓存。
- 请求限流和前端成本指标面板。
- 直播式主界面：上方视频画面、下方可滚动对话历史，状态/日志/成本/设置放入顶部菜单。

## 必交内容

- 可运行的应用源码。
- README：包含项目介绍、依赖说明、启动方式和 demo 指引。
- demo 视频。
- 设计文档：[docs/design.md](docs/design.md)，需要说明：
  - 计划实现哪些用户故事，最终实现了哪些。
  - 想到了哪些运营成本控制技巧，实际采用了哪些。

## 技术栈

当前应用骨架使用：

- Next.js 16
- React 19
- TypeScript
- ESLint

当前实现已接入 OpenAI Realtime/WebRTC 和多模态视觉分析能力。

## 第三方依赖与原创功能边界

第三方依赖：

- `next`：应用框架和路由。
- `react` / `react-dom`：前端组件渲染。
- `typescript`：类型检查。
- `eslint` / `eslint-config-next`：代码质量检查。

当前原创功能：

- 项目交付规范与 PR 流程设计。
- AI 视觉对话助手的应用工作区界面。
- 会话状态模型与 mock 交互流程。
- 本地摄像头/麦克风采集、视觉抽帧压缩、视觉分析 API、Realtime WebRTC 语音连接、语音转写与打断控制。
- 语音视觉上下文融合：检测用户语音中的视觉意图，按需抽取当前画面生成摘要，并注入 Realtime 对话。
- 成本控制、最终文档和验收修复模块均在本仓库内分 PR 独立实现。

如后续引入 Vercel AI SDK、OpenAI SDK、WebRTC 示例代码或复用个人历史代码，必须在对应 PR 描述和 README 中说明来源、用途和原创实现边界。

## 本地启动

环境要求：

- Node.js 22 或更高版本
- npm

首次运行：

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开浏览器访问：

```text
http://localhost:3000
```

摄像头和麦克风需要浏览器安全上下文。建议在本机测试时使用 `http://localhost:3000`。如果使用局域网 IP，例如 `http://10.29.137.100:3000`，部分浏览器会禁用 `getUserMedia`，需要改用 HTTPS 或回到 localhost 测试。

首次进入页面会先显示配置页。你只需要输入 OpenAI API Key 和 Base URL，配置会保存到当前浏览器的 localStorage。下次打开同一浏览器时会自动进入主界面，无需重复输入。语音模式和模型细节在主界面顶部“设置”菜单中管理。

也可以在 `.env.local` 中配置服务端备用值：

```bash
OPENAI_API_KEY=你的 OpenAI API Key
OPENAI_CHAT_MODEL=gpt-5.5
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_REALTIME_VOICE=marin
OPENAI_REALTIME_TRANSCRIPTION_MODEL=whisper-1
OPENAI_VISION_MODEL=gpt-5.5
LOCAL_STT_URL=http://127.0.0.1:8765/stt
LOCAL_TTS_URL=http://127.0.0.1:8765/tts
LOCAL_VOICE_URL=http://127.0.0.1:8766/voice/turn
LOCAL_TTS_VOICE=
```

如果前端配置页填写了 API Key 和 Base URL，服务端 API Route 会优先使用本次请求携带的配置；如果没有填写，则回退到 `.env.local`。配置页保存的是浏览器本地 localStorage，适合本地开发和 demo，不适合作为生产级密钥托管方案。

视觉分析默认使用低细节图片输入和较短输出，以控制调用成本。默认语音模式是“语音流水线”：前端用 Web Audio VAD 检测一句话开始和结束，把该 turn 的音频通过 HTTP POST 发给本地 Node 语音服务，并通过 SSE 接收 STT、LLM、TTS 和视觉 tool 事件。设置菜单里也可以切换到 OpenAI Realtime 模式；Realtime 会话通过服务端创建临时 client secret，浏览器只使用短期凭据建立 WebRTC 连接。

本地 STT/TTS 不绑定具体模型实现。建议本机另起一个轻量服务封装 faster-whisper、whisper.cpp、Piper 或 sherpa-onnx：

- 本地 STT：`POST /stt`，接收 `multipart/form-data` 的 `audio` 文件字段，返回 JSON：`{"text":"识别文本"}`。
- 本地 TTS：`POST /tts`，接收 JSON：`{"text":"待合成文本","voice":"可选声音"}`，直接返回 `audio/wav`、`audio/mpeg` 等音频；也可返回 JSON：`{"audioBase64":"...","mimeType":"audio/wav"}`。

仓库提供了一个本机开发用语音服务，STT 使用 whisper.cpp，TTS 使用 macOS `say`。推荐使用 Node 编排服务：

```bash
bash scripts/setup_local_voice.sh
npm run voice:local
```

启动后访问 `http://127.0.0.1:8766/health`，如果返回 `ok: true`，即可在设置中把“本地语音会话地址”设为 `http://127.0.0.1:8766/voice/turn`。
健康检查会返回 `ffmpeg`、`whisper-cli`、本地模型文件和 macOS `say` 的可用性；如果 `ok: false`，先根据 `checks` 字段补齐本地环境。
如果浏览器不是运行在这台 Mac 上，例如用手机或其他局域网设备访问 `http://10.x.x.x:3000`，不要填写 `127.0.0.1`，因为它指向浏览器所在设备本身。此时需要用 `LOCAL_VOICE_HOST=0.0.0.0 npm run voice:local` 启动服务，并把“本地语音会话地址”改为 `http://这台Mac的局域网IP:8766/voice/turn`。

本地 Node 服务接口：

- `POST /voice/turn`：接收 `multipart/form-data` 的 `audio`、`config`、`sessionId`、`turnId`，返回 `text/event-stream`。
- SSE 事件包括 `stt.final`、`tool.call`、`tool.result`、`llm.delta`、`tts.start`、`tts.sentence_start`、`tts.audio`、`tts.stop`、`done`、`error`。
- `POST /voice/tool-result`：前端收到视觉 tool 请求后补传当前压缩帧。

当用户通过语音询问“画面里有什么”“我面前是什么”等视觉问题时，本地 Node 服务会先根据关键词映射触发视觉 tool，前端补传当前摄像头画面，服务端完成视觉分析后把摘要作为上下文注入回答。
前端“实时转写”区域会显示 RMS、录音时长、音频大小、turnId 和最近 STT 文本，用于验证麦克风确实触发了 VAD、录音上传和本地转写。

当前已采用的成本控制策略：

- 视觉分析只上传压缩后的单帧图片，不上传连续视频流。
- 图片输入使用低细节模式，并限制图片 data URL 大小。
- 视觉问题默认缓存 60 秒，连续追问优先复用最近视觉摘要。
- `/api/vision` 按客户端指纹做每小时 20 次限流。
- `/api/realtime/session` 按客户端指纹做每小时 12 次限流。
- Realtime 系统提示限制常规回答不超过 3 句话，减少无意义长输出。
- 前端成本面板展示视觉请求次数、缓存命中和最近图片体积，便于 demo 讲解。

常用命令：

```bash
npm run lint
npm run typecheck
npm run build
```

核心功能手动验证：

1. 启动应用并授权摄像头、麦克风。
2. 首次进入时填写 OpenAI API Key、Base URL 和模型配置并保存。
3. 默认使用“语音流水线”，点击“开始语音”后直接说话；如需 Realtime，可在设置菜单切换模式后点击“连接语音”。
4. 先说一句普通问题，观察“实时转写”是否显示 STT 文本；等待 AI 回复后再说第二句，确认会生成新的 turn。
5. 说出“我面前有什么”或“看一下画面里是什么”。
6. 观察视觉 tool 是否自动抓帧并注入上下文，AI 是否结合画面回答。
7. 在 AI 回复时继续说话，确认回复可被打断。
8. 点击顶部“设置”，确认可以修改或清除配置。

## 演示流程

建议 demo 视频按以下顺序录制：

1. 展示 README、设计文档和 PR 记录。
2. 启动项目，展示进入主界面前的 OpenAI 配置页。
3. 保存 API Key 和 Base URL，说明下次进入无需重复输入。
4. 点击“开始”，授权摄像头和麦克风。
5. 展示摄像头预览、麦克风电平和直播式主界面。
6. 点击“分析画面”，展示抽帧预览和视觉分析结果。
7. 展示默认语音流水线模式：浏览器语音识别、文本模型回复、浏览器语音播放。
8. 语音提问“我面前有什么”，展示视觉上下文注入和 AI 回答。
9. 在 AI 回复时继续说话，展示插话打断。
10. 通过顶部“设置”菜单展示语音模式切换，可选“语音流水线”或“OpenAI Realtime”。
11. 通过顶部菜单展示状态、日志和成本控制面板。
12. 讲解成本控制策略：不传连续视频、低细节图片、60 秒缓存、API 限流和短回答。

## Demo 视频

最终提交前需补充可访问的视频链接：

```text
待补充：录制完成后替换为可访问的视频链接
```

视频要求：

- 使用声音完整讲解。
- 展示作品主要功能和效果。
- 覆盖摄像头、麦克风、视觉理解、语音/文字回应、成本控制等核心模块。
- 上传到可访问平台，例如 bilibili、云盘等。

## 开发规范

为了满足持续交付和学术诚信要求，本项目采用小步提交、按功能开 PR 的方式开发。

1. 每个功能或修复创建独立分支。
2. 每个 PR 只实现或修改一个清晰目标。
3. commit 信息遵循 [.gitmessage](.gitmessage) 中的格式。
4. PR 标题、PR 描述和 commit 说明使用中文，描述需要包含功能说明、实现思路和测试方式。
5. 合并后 `main` 分支必须保持可运行状态。
6. PR 不允许空描述，描述必须与实际变更一致。
7. 所有 commit 时间戳必须落在所选批次开始与截止时间内。
8. 不在最后一天一次性导入大量代码。
9. 如引入第三方库或框架，必须在 README 中列明依赖并说明原创功能部分。
10. 如复用个人过去代码，必须在 PR 描述中注明来源。

## 建议分支命名

- `feature/<name>`：新增功能。
- `fix/<name>`：问题修复。
- `docs/<name>`：文档更新。
- `chore/<name>`：工程配置或维护工作。

## 建议 commit 格式

```text
type(scope): summary
```

示例：

```text
docs(readme): 补充最终演示与启动说明
feat(camera): 增加摄像头预览采集
feat(audio): 接入实时语音输入
fix(turn): 修复回复打断状态
```

## 参考规则

从 `ref/` 中提炼出的项目要求和提交规范见 [docs/requirements.md](docs/requirements.md)。

## 最终提交检查清单

- [ ] 仓库在评审阶段可公开访问或评委可访问。
- [x] 所有功能均通过连续 PR 和 commit 记录体现。
- [x] 所有 PR 标题和描述完整，包含功能描述、实现思路和测试方式。
- [x] `main` 分支可安装、启动和复现 demo。
- [x] README 包含启动方式、依赖说明、原创功能边界和 demo 视频占位。
- [x] [docs/design.md](docs/design.md) 已补全用户故事和成本控制策略。
- [ ] demo 视频可播放，并覆盖核心模块。
- [x] 没有未说明来源的第三方代码或个人历史代码。
