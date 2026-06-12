"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useLocalMedia, type MediaPermissionState } from "../lib/use-local-media";

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
    idle: "会话已停止，本地摄像头和麦克风轨道已释放。",
    connecting: "正在模拟建立实时会话，后续会替换为 Realtime 临时会话。",
    listening: "本地摄像头和麦克风已就绪。当前音视频只在浏览器内使用。",
    thinking: "模拟触发画面分析。后续会从视频帧抽取图片并请求视觉模型。",
    speaking: "模拟 AI 回复中。后续会替换为流式文本和语音播放。",
    error: "媒体采集或模拟流程出现异常，请查看状态提示。",
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

function getCameraStatus(permissionState: MediaPermissionState, hasVideo: boolean) {
  if (permissionState === "requesting") {
    return "请求权限";
  }

  if (permissionState === "blocked") {
    return "权限被拒";
  }

  if (permissionState === "error") {
    return "不可用";
  }

  return hasVideo ? "本地预览中" : "待授权";
}

function getMicrophoneStatus(
  permissionState: MediaPermissionState,
  hasAudio: boolean,
  isMuted: boolean,
) {
  if (permissionState === "requesting") {
    return "请求权限";
  }

  if (permissionState === "blocked") {
    return "权限被拒";
  }

  if (permissionState === "error") {
    return "不可用";
  }

  if (!hasAudio) {
    return "待授权";
  }

  return isMuted ? "已静音" : "本地采集中";
}

export function ConversationWorkspace() {
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [timeline, setTimeline] = useState<TimelineEvent[]>(initialTimeline);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const {
    permissionState,
    stream,
    audioLevel,
    errorMessage,
    hasVideo,
    hasAudio,
    startMedia,
    stopMedia,
  } = useLocalMedia();

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const statusItems = useMemo(
    () => [
      { label: "摄像头", value: getCameraStatus(permissionState, hasVideo) },
      {
        label: "麦克风",
        value: getMicrophoneStatus(permissionState, hasAudio, isMuted),
      },
      { label: "实时会话", value: sessionLabels[sessionState] },
      { label: "视觉分析", value: sessionState === "thinking" ? "模拟分析中" : "待触发" },
    ],
    [hasAudio, hasVideo, isMuted, permissionState, sessionState],
  );

  const currentStep = sessionOrder.indexOf(sessionState);

  const appendInteraction = useCallback((nextState: SessionState, action: SessionAction) => {
    setMessages((current) => [...current, createMessage(nextState, action)].slice(-6));
    setTimeline((current) =>
      [createTimelineEvent(nextState, action), ...current].slice(0, 5),
    );
  }, []);

  async function handleStart() {
    setSessionState("connecting");
    setMessages((current) =>
      [
        ...current,
        {
          id: `media-request-${Date.now()}`,
          role: "system",
          content: "正在请求摄像头和麦克风权限。音视频不会上传到服务器。",
          status: "complete",
        } satisfies ChatMessage,
      ].slice(-6),
    );

    const result = await startMedia();

    if (result.ok) {
      setSessionState("listening");
      appendInteraction("listening", "start");
      return;
    }

    setSessionState("error");
    setMessages((current) =>
      [
        ...current,
        {
          id: `media-error-${Date.now()}`,
          role: "system",
          content: result.errorMessage,
          status: "complete",
        } satisfies ChatMessage,
      ].slice(-6),
    );
    setTimeline((current) =>
      [
        {
          id: `media-error-timeline-${Date.now()}`,
          label: "权限",
          detail: "本地媒体采集未启动",
        },
        ...current,
      ].slice(0, 5),
    );
  }

  function handleStop() {
    stopMedia();
    setIsMuted(false);
    setSessionState("idle");
    appendInteraction("idle", "stop");
  }

  function handleAction(action: Exclude<SessionAction, "start" | "stop">) {
    const nextState =
      action === "mute" ? sessionState : getNextSessionState(sessionState, action);

    if (action === "mute") {
      setIsMuted((current) => !current);
    }

    setSessionState(nextState);
    appendInteraction(nextState, action);
  }

  useEffect(() => {
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
  }, [isMuted, stream]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Audai</p>
          <h1>AI 视觉对话助手</h1>
        </div>
        <div className="build-tag">PR 3</div>
      </header>

      <section className="workspace" aria-label="对话工作区">
        <div className="video-panel">
          <div className="video-frame">
            <video
              ref={videoRef}
              aria-label="本地摄像头预览"
              autoPlay
              muted
              playsInline
            />

            <div className={`video-status state-${sessionState}`}>
              <span className="pulse" />
              <span>{sessionLabels[sessionState]}</span>
            </div>

            <div className="video-overlay">
              <strong>
                {errorMessage ?? sessionDescriptions[sessionState]}
              </strong>
              <span>
                {stream
                  ? "摄像头与麦克风仅在浏览器本地采集，当前不会上传。"
                  : "点击开始后浏览器会请求摄像头和麦克风权限。"}
              </span>
              <div className="audio-meter" aria-label="麦克风输入电平">
                <span style={{ width: `${Math.round(audioLevel * 100)}%` }} />
              </div>
            </div>
          </div>

          <div className="control-bar" aria-label="会话控制">
            <button
              type="button"
              onClick={handleStart}
              disabled={sessionState === "connecting" || permissionState === "requesting"}
            >
              {stream ? "重启采集" : "开始"}
            </button>
            <button
              type="button"
              onClick={() => handleAction("mute")}
              disabled={!hasAudio || sessionState === "idle" || sessionState === "error"}
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
              onClick={handleStop}
              disabled={!stream && sessionState === "idle"}
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
