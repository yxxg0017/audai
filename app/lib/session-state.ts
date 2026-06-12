export type SessionState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type SessionAction = "start" | "mute" | "analyze" | "stop" | "fail";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "sent" | "streaming" | "complete";
};

export type TimelineEvent = {
  id: string;
  label: string;
  detail: string;
};

export const sessionLabels: Record<SessionState, string> = {
  idle: "待开始",
  connecting: "连接中",
  listening: "聆听中",
  thinking: "思考中",
  speaking: "回复中",
  error: "异常",
};

export const sessionDescriptions: Record<SessionState, string> = {
  idle: "点击开始后进入模拟会话，后续 PR 将接入真实媒体流。",
  connecting: "正在建立会话状态，当前使用 mock 流程演示。",
  listening: "模拟麦克风输入已就绪，可触发画面分析或停止会话。",
  thinking: "模拟 AI 正在整理语音和视觉上下文。",
  speaking: "模拟 AI 正在输出回复，后续会替换为流式音频和文本。",
  error: "模拟错误状态，用于验证恢复路径和提示样式。",
};

export function getNextSessionState(
  current: SessionState,
  action: SessionAction,
): SessionState {
  if (action === "fail") {
    return "error";
  }

  if (action === "stop") {
    return "idle";
  }

  if (action === "start") {
    return current === "idle" || current === "error" ? "connecting" : "listening";
  }

  if (action === "mute") {
    return current === "listening" ? "thinking" : "listening";
  }

  if (action === "analyze") {
    return current === "speaking" ? "listening" : "thinking";
  }

  return current;
}

export const initialMessages: ChatMessage[] = [
  {
    id: "system-setup",
    role: "system",
    content: "会话工作区已准备好。当前为 PR 2 的 mock 状态，不会调用摄像头、麦克风或模型。",
    status: "complete",
  },
  {
    id: "assistant-preview",
    role: "assistant",
    content: "后续我会结合你的语音问题和摄像头画面回答。现在可以先验证界面状态切换。",
    status: "complete",
  },
];

export const initialTimeline: TimelineEvent[] = [
  {
    id: "timeline-ready",
    label: "工作区",
    detail: "基础界面已加载",
  },
  {
    id: "timeline-mock",
    label: "状态模型",
    detail: "使用 mock 数据验证交互",
  },
];
