"use client";

import { useMemo, useState } from "react";
import {
  getNextSessionState,
  initialMessages,
  initialTimeline,
  sessionDescriptions,
  sessionLabels,
  type ChatMessage,
  type SessionAction,
  type SessionState,
  type TimelineEvent,
} from "../lib/session-state";

const sessionOrder: SessionState[] = [
  "idle",
  "connecting",
  "listening",
  "thinking",
  "speaking",
  "error",
];

function createMessage(state: SessionState, action: SessionAction): ChatMessage {
  const messageByState: Record<SessionState, string> = {
    idle: "会话已停止。媒体轨道将在后续模块中释放。",
    connecting: "正在模拟建立实时会话，后续会替换为 Realtime 临时会话。",
    listening: "模拟进入聆听状态。后续这里会展示麦克风输入和语音转写。",
    thinking: "模拟触发画面分析。后续会从视频帧抽取图片并请求视觉模型。",
    speaking: "模拟 AI 回复中。后续会替换为流式文本和语音播放。",
    error: "模拟异常状态。后续会承载权限、网络和模型调用错误。",
  };

  return {
    id: `${action}-${Date.now()}`,
    role: action === "analyze" ? "user" : "assistant",
    content: messageByState[state],
    status: state === "speaking" ? "streaming" : "complete",
  };
}

function createTimelineEvent(
  state: SessionState,
  action: SessionAction,
): TimelineEvent {
  const actionLabels: Record<SessionAction, string> = {
    start: "开始",
    mute: "静音",
    analyze: "分析",
    stop: "停止",
    fail: "异常",
  };

  return {
    id: `${action}-timeline-${Date.now()}`,
    label: actionLabels[action],
    detail: `状态切换为${sessionLabels[state]}`,
  };
}

export function ConversationWorkspace() {
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [timeline, setTimeline] = useState<TimelineEvent[]>(initialTimeline);

  const statusItems = useMemo(
    () => [
      { label: "摄像头", value: sessionState === "idle" ? "待授权" : "模拟就绪" },
      { label: "麦克风", value: isMuted ? "已静音" : "待输入" },
      { label: "实时会话", value: sessionLabels[sessionState] },
      { label: "视觉分析", value: sessionState === "thinking" ? "模拟分析中" : "待触发" },
    ],
    [isMuted, sessionState],
  );

  const currentStep = sessionOrder.indexOf(sessionState);

  function handleAction(action: SessionAction) {
    const nextState = getNextSessionState(sessionState, action);

    if (action === "mute") {
      setIsMuted((current) => !current);
    }

    setSessionState(nextState);
    setMessages((current) => [...current, createMessage(nextState, action)].slice(-6));
    setTimeline((current) =>
      [createTimelineEvent(nextState, action), ...current].slice(0, 5),
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Audai</p>
          <h1>AI 视觉对话助手</h1>
        </div>
        <div className="build-tag">PR 2</div>
      </header>

      <section className="workspace" aria-label="对话工作区">
        <div className="video-panel">
          <div className="video-frame">
            <div className={`video-status state-${sessionState}`}>
              <span className="pulse" />
              <span>{sessionLabels[sessionState]}</span>
            </div>

            <div className="video-overlay">
              <strong>{sessionDescriptions[sessionState]}</strong>
              <span>真实摄像头预览将在媒体采集 PR 中接入</span>
            </div>
          </div>

          <div className="control-bar" aria-label="会话控制">
            <button
              type="button"
              onClick={() => handleAction("start")}
              disabled={sessionState === "connecting"}
            >
              开始
            </button>
            <button
              type="button"
              onClick={() => handleAction("mute")}
              disabled={sessionState === "idle" || sessionState === "error"}
            >
              {isMuted ? "取消静音" : "静音"}
            </button>
            <button
              type="button"
              onClick={() => handleAction("analyze")}
              disabled={sessionState === "idle" || sessionState === "error"}
            >
              分析画面
            </button>
            <button type="button" onClick={() => handleAction("fail")}>
              模拟异常
            </button>
            <button
              type="button"
              onClick={() => handleAction("stop")}
              disabled={sessionState === "idle"}
            >
              停止
            </button>
          </div>

          <section className="conversation-panel" aria-label="对话消息">
            {messages.map((message) => (
              <article className={`message message-${message.role}`} key={message.id}>
                <div className="message-meta">
                  <span>{message.role === "user" ? "用户" : message.role === "assistant" ? "AI" : "系统"}</span>
                  <small>{message.status === "streaming" ? "流式输出" : "完成"}</small>
                </div>
                <p>{message.content}</p>
              </article>
            ))}
          </section>
        </div>

        <aside className="side-panel" aria-label="会话状态">
          <div className="status-grid">
            {statusItems.map((item) => (
              <div className="status-item" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>

          <div className="state-track" aria-label="状态流程">
            {sessionOrder.map((state, index) => (
              <div
                className={`state-step ${index <= currentStep ? "is-active" : ""}`}
                key={state}
              >
                <span>{index + 1}</span>
                <p>{sessionLabels[state]}</p>
              </div>
            ))}
          </div>

          <div className="timeline">
            {timeline.map((item) => (
              <div className="timeline-row" key={item.id}>
                <span className="dot" />
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
