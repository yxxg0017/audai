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
  listening: "本地音视频采集已就绪，可进行后续视觉抽帧或实时语音接入。",
  thinking: "模拟 AI 正在整理语音和视觉上下文。",
  speaking: "模拟 AI 正在输出回复，后续会替换为流式音频和文本。",
  error: "媒体权限、设备或模拟流程出现异常。",
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
    content: "会话工作区已准备好。当前模块会采集本地摄像头和麦克风，但不会上传音视频或调用模型。",
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
