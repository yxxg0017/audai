# AI 视觉对话助手

本仓库用于完成 3 天议题实战项目：开发一款能调用摄像头和麦克风的 AI 对话应用，让 AI 可以看到实时画面、听到用户语音，并给出合适回应。

当前仓库处于私有开发阶段；最终提交前需要按活动要求确认仓库可访问性、README、设计文档和 demo 视频无误。

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

## 开发规范

为了满足持续交付和学术诚信要求，本项目采用小步提交、按功能开 PR 的方式开发。

1. 每个功能或修复创建独立分支。
2. 每个 PR 只实现或修改一个清晰目标。
3. commit 信息遵循 [.gitmessage](.gitmessage) 中的格式。
4. PR 描述需要包含功能说明、实现思路和测试方式。
5. 合并后 `main` 分支必须保持可运行状态。

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
