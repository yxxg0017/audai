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
  idle: "点击开始后浏览器会请求摄像头和麦克风权限。",
  connecting: "正在请求并连接本地摄像头和麦克风。",
  listening: "本地音视频采集已就绪，可进行视觉抽帧或实时语音对话。",
  thinking: "AI 正在整理语音和视觉上下文。",
  speaking: "AI 正在输出实时语音或文本回复。",
  error: "媒体权限、设备或会话流程出现异常。",
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
    content: "会话工作区已准备好。摄像头画面默认只在本地预览，视觉分析会按需上传压缩抽帧。",
    status: "complete",
  },
  {
    id: "assistant-preview",
    role: "assistant",
    content: "你可以先开始采集，再连接语音或分析当前画面。",
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
