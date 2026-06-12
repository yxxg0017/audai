# AI 视觉对话助手

本仓库用于完成 3 天议题实战项目：开发一款能调用摄像头和麦克风的 AI 对话应用，让 AI 可以看到实时画面、听到用户语音，并给出合适回应。

当前仓库处于私有开发阶段；最终提交前需要按活动要求确认仓库可访问性、README、设计文档和 demo 视频无误。

## 提交状态

- 代码仓库：开发期间可保持私有，提交截止后需改为公开或确保评委可访问。
- demo 视频：待录制，最终链接需补充到 README。
- 设计文档：[docs/design.md](docs/design.md)，需在最终提交前补全用户故事和成本控制策略。
- 提交方式：所有新增功能必须通过 PR 合并，避免最后一天一次性导入代码。

## 项目目标

应用需要实现：

- 在用户授权后打开摄像头和麦克风。
- 采集摄像头画面，让 AI 理解当前视觉内容。
- 采集用户语音，让 AI 理解用户问题或指令。
- 以自然、低延迟的方式返回文字或语音回应。
- 综合考虑视觉理解准确性、语音交互流畅度，以及端云协同下的运营成本控制。

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

后续模块会继续接入 Vercel AI SDK、OpenAI Realtime/WebRTC 和多模态视觉分析能力。

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
- 后续成本控制、最终文档和验收修复模块均在本仓库内分 PR 独立实现。

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

视觉分析需要在 `.env.local` 中配置：

```bash
OPENAI_API_KEY=你的 OpenAI API Key
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_REALTIME_VOICE=marin
OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
OPENAI_VISION_MODEL=gpt-5.5
```

`OPENAI_API_KEY` 只会在服务端 API Route 中读取，不会暴露给浏览器。视觉分析默认使用低细节图片输入和较短输出，以控制调用成本。Realtime 语音会话通过服务端创建临时 client secret，浏览器只使用短期凭据建立 WebRTC 连接。实时语音默认开启服务端 VAD、中文转写和用户插话打断，减少前端手写音频分段逻辑。

当用户通过语音询问“画面里有什么”“我面前是什么”等视觉问题时，前端会按需抽取当前摄像头画面并请求视觉分析，然后把摘要作为上下文发送到 Realtime 会话。视觉上下文默认缓存 60 秒，静止画面或连续追问会优先复用最近摘要，避免重复调用视觉模型。

常用命令：

```bash
npm run lint
npm run typecheck
npm run build
```

核心功能手动验证：

1. 启动应用并授权摄像头、麦克风。
2. 点击“连接语音”，等待实时语音状态变为已连接。
3. 说出“我面前有什么”或“看一下画面里是什么”。
4. 观察侧栏“语音视觉上下文”是否生成并注入，AI 是否结合画面回答。
5. 在 AI 回复时继续说话，确认回复可被打断。

## Demo 视频

最终提交前需补充可访问的视频链接：

```text
待补充
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
4. PR 描述需要包含功能说明、实现思路和测试方式。
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
docs(readme): translate project overview to Chinese
feat(camera): add camera preview capture
feat(audio): stream microphone input to realtime session
fix(turn): handle interruption during assistant response
```

## 参考规则

从 `ref/` 中提炼出的项目要求和提交规范见 [docs/requirements.md](docs/requirements.md)。

## 最终提交检查清单

- [ ] 仓库在评审阶段可公开访问或评委可访问。
- [ ] 所有功能均通过连续 PR 和 commit 记录体现。
- [ ] 所有 PR 标题和描述完整，包含功能描述、实现思路和测试方式。
- [ ] `main` 分支可安装、启动和复现 demo。
- [ ] README 包含启动方式、依赖说明、原创功能边界和 demo 视频链接。
- [ ] [docs/design.md](docs/design.md) 已补全用户故事和成本控制策略。
- [ ] demo 视频可播放，并覆盖核心模块。
- [ ] 没有未说明来源的第三方代码或个人历史代码。
