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
import {
  captureCompressedFrame,
  type CapturedFrame,
} from "../lib/frame-capture";
import { useLocalMedia, type MediaPermissionState } from "../lib/use-local-media";
import {
  useRealtimeAudio,
  type RealtimeConnectionState,
  type RealtimeTurnState,
} from "../lib/use-realtime-audio";
import type { ClientConfig } from "../lib/client-config";
import { useVoicePipeline } from "../lib/use-voice-pipeline";
import type { VoicePipelineState } from "../lib/use-voice-pipeline";

const sessionOrder: SessionState[] = [
  "idle",
  "connecting",
  "listening",
  "thinking",
  "speaking",
  "error",
];
const defaultVisionQuestion =
  "请用中文简要描述画面中的主要内容，并指出需要注意的细节。";
const visualIntentKeywords = [
  "画面",
  "看到",
  "看见",
  "面前",
  "镜头",
  "摄像头",
  "这是什么",
  "有什么",
  "桌上",
  "手里",
];
const visionContextTtlMs = 60_000;
const maxMessageHistory = 80;

type VisionApiResponse = {
  analysis?: string;
  model?: string;
  error?: string;
};

type VisionContext = {
  summary: string;
  question: string;
  model: string | null;
  capturedAt: number;
  sizeBytes: number;
};

function shouldUseVisionForTranscript(text: string) {
  const normalizedText = text.trim().toLowerCase();

  return visualIntentKeywords.some((keyword) =>
    normalizedText.includes(keyword.toLowerCase()),
  );
}

function isFreshVisionContext(context: VisionContext | null) {
  return Boolean(context && Date.now() - context.capturedAt < visionContextTtlMs);
}

function createMessage(state: SessionState, action: SessionAction): ChatMessage {
  const messageByState: Record<SessionState, string> = {
    idle: "会话已停止，本地摄像头和麦克风轨道已释放。",
    connecting: "正在建立本地媒体或 Realtime 实时会话。",
    listening: "本地摄像头和麦克风已就绪。当前音视频只在浏览器内使用。",
    thinking: "正在整理语音问题、视觉上下文或模型响应。",
    speaking: "AI 正在输出实时语音或文本回复。",
    error: "媒体采集或会话流程出现异常，请查看状态提示。",
  };

  return {
    id: `${action}-${Date.now()}`,
    role: action === "analyze" ? "user" : "assistant",
    content: messageByState[state],
    status: state === "speaking" ? "streaming" : "complete",
  };
}

function keepMessageHistory(messages: ChatMessage[]) {
  return messages.slice(-maxMessageHistory);
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

function getRealtimeStatus(connectionState: RealtimeConnectionState) {
  const labels: Record<RealtimeConnectionState, string> = {
    idle: "待连接",
    connecting: "连接中",
    connected: "已连接",
    closed: "已关闭",
    error: "连接异常",
  };

  return labels[connectionState];
}

function getRealtimeTurnStatus(turnState: RealtimeTurnState) {
  const labels: Record<RealtimeTurnState, string> = {
    idle: "未开始",
    listening: "等待用户说话",
    user_speaking: "用户说话中",
    thinking: "模型思考中",
    assistant_speaking: "AI 回复中",
    interrupted: "已插话中断",
    error: "回合异常",
  };

  return labels[turnState];
}

function getSessionStateFromRealtime(
  connectionState: RealtimeConnectionState,
  turnState: RealtimeTurnState,
  fallbackState: SessionState,
) {
  if (connectionState !== "connected") {
    return fallbackState;
  }

  const stateByRealtimeTurn: Partial<Record<RealtimeTurnState, SessionState>> = {
    listening: "listening",
    user_speaking: "listening",
    thinking: "thinking",
    assistant_speaking: "speaking",
    interrupted: "listening",
    error: "error",
  };

  return stateByRealtimeTurn[turnState] ?? fallbackState;
}

function getSessionStateFromPipeline(
  pipelineState: VoicePipelineState,
  fallbackState: SessionState,
) {
  const stateByPipeline: Partial<Record<VoicePipelineState, SessionState>> = {
    listening: "listening",
    thinking: "thinking",
    speaking: "speaking",
    error: "error",
  };

  return stateByPipeline[pipelineState] ?? fallbackState;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

type ConversationWorkspaceProps = {
  clientConfig: ClientConfig;
  onOpenSettings: () => void;
};

export function ConversationWorkspace({
  clientConfig,
  onOpenSettings,
}: ConversationWorkspaceProps) {
  const [activeMenu, setActiveMenu] = useState<
    "status" | "logs" | "cost" | null
  >(null);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [timeline, setTimeline] = useState<TimelineEvent[]>(initialTimeline);
  const [latestFrame, setLatestFrame] = useState<CapturedFrame | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [visionQuestion, setVisionQuestion] = useState(defaultVisionQuestion);
  const [visionAnalysis, setVisionAnalysis] = useState<string | null>(null);
  const [visionModel, setVisionModel] = useState<string | null>(null);
  const [isVisionLoading, setIsVisionLoading] = useState(false);
  const [visionContext, setVisionContext] = useState<VisionContext | null>(null);
  const [visionContextStatus, setVisionContextStatus] =
    useState("等待语音视觉问题");
  const [visionRequestCount, setVisionRequestCount] = useState(0);
  const [visionCacheHitCount, setVisionCacheHitCount] = useState(0);
  const handledTranscriptIdsRef = useRef<Set<string>>(new Set());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
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
  const {
    connectionState,
    errorMessage: realtimeError,
    remoteStream,
    model: realtimeModel,
    voice: realtimeVoice,
    transcriptionModel,
    turnState,
    interruptionCount,
    transcripts,
    events: realtimeEvents,
    cancelResponse,
    injectVisionContext,
    connect: connectRealtime,
    disconnect: disconnectRealtime,
  } = useRealtimeAudio();
  const voicePipeline = useVoicePipeline();
  const isPipelineMode = clientConfig.voiceMode === "pipeline";

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const statusItems = useMemo(
    () => [
      { label: "摄像头", value: getCameraStatus(permissionState, hasVideo) },
      {
        label: "麦克风",
        value: getMicrophoneStatus(permissionState, hasAudio, isMuted),
      },
      {
        label: "实时会话",
        value: isPipelineMode
          ? `流水线 ${voicePipeline.state}`
          : connectionState === "connected"
            ? getRealtimeTurnStatus(turnState)
            : getRealtimeStatus(connectionState),
      },
      {
        label: "视觉分析",
        value: isVisionLoading
          ? "分析中"
          : latestFrame
            ? `${latestFrame.width}x${latestFrame.height}`
            : "待抽帧",
      },
    ],
    [
      hasAudio,
      hasVideo,
      isMuted,
      isVisionLoading,
      latestFrame,
      permissionState,
      connectionState,
      isPipelineMode,
      turnState,
      voicePipeline.state,
    ],
  );

  const displayedSessionState = isPipelineMode
    ? getSessionStateFromPipeline(voicePipeline.state, sessionState)
    : getSessionStateFromRealtime(connectionState, turnState, sessionState);
  const currentStep = sessionOrder.indexOf(displayedSessionState);
  const latestUserTranscript = transcripts.find(
    (transcript) =>
      transcript.role === "user" && transcript.status === "complete",
  );

  const appendInteraction = useCallback((nextState: SessionState, action: SessionAction) => {
    setMessages((current) =>
      keepMessageHistory([...current, createMessage(nextState, action)]),
    );
    setTimeline((current) =>
      [createTimelineEvent(nextState, action), ...current].slice(0, 5),
    );
  }, []);

  const appendPipelineExchange = useCallback((question: string, answer: string) => {
    setMessages((current) =>
      keepMessageHistory([
        ...current,
        {
          id: `pipeline-user-${Date.now()}`,
          role: "user",
          content: question,
          status: "complete",
        },
        {
          id: `pipeline-assistant-${Date.now()}`,
          role: "assistant",
          content: answer,
          status: "complete",
        },
      ]),
    );
  }, []);

  const analyzeAndInjectVisionContext = useCallback(
    async (question: string, source: "voice" | "manual") => {
      const trimmedQuestion = question.trim() || defaultVisionQuestion;

      if (!isPipelineMode && connectionState !== "connected") {
        setVisionContextStatus("请先连接 Realtime 语音，再发送视觉上下文。");
        return undefined;
      }

      if (!videoRef.current || !stream || !hasVideo) {
        setVisionContextStatus("请先开始摄像头采集，再发送视觉上下文。");
        return undefined;
      }

      setVisionContextStatus(
        source === "voice" ? "检测到视觉问题，准备上下文。" : "正在准备视觉上下文。",
      );

      try {
        let context = visionContext;
        let usedCachedContext = isFreshVisionContext(context);

        if (!usedCachedContext) {
          const frame = await captureCompressedFrame(videoRef.current);
          setLatestFrame(frame);
          setVisionRequestCount((current) => current + 1);

          const response = await fetch("/api/vision", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageDataUrl: frame.dataUrl,
              openai: clientConfig,
              question: [
                `用户刚刚语音提问：${trimmedQuestion}`,
                "请提取当前画面中与问题相关的事实，控制在 120 字以内。",
              ].join("\n"),
            }),
          });
          const payload = (await response.json()) as VisionApiResponse;

          if (!response.ok || !payload.analysis) {
            throw new Error(payload.error ?? "视觉上下文生成失败。");
          }

          context = {
            summary: payload.analysis,
            question: trimmedQuestion,
            model: payload.model ?? null,
            capturedAt: Date.now(),
            sizeBytes: frame.sizeBytes,
          };
          setVisionContext(context);
          setVisionAnalysis(payload.analysis);
          setVisionModel(payload.model ?? null);
          usedCachedContext = false;
        }

        if (!context) {
          throw new Error("视觉上下文为空，无法注入 Realtime 会话。");
        }

        if (usedCachedContext) {
          setVisionCacheHitCount((current) => current + 1);
        }

        if (isPipelineMode) {
          setVisionContextStatus(
            usedCachedContext
              ? "已准备缓存视觉上下文。"
              : "已准备新的视觉上下文。",
          );
          return context.summary;
        }

        const injected = injectVisionContext({
          summary: context.summary,
          userQuestion: trimmedQuestion,
        });

        if (!injected) {
          setVisionContextStatus("Realtime data channel 未就绪，视觉上下文未发送。");
          return undefined;
        }

        setVisionContextStatus(
          usedCachedContext
            ? "已发送缓存视觉上下文。"
            : "已发送新的视觉上下文。",
        );
        setTimeline((current) =>
          [
            {
              id: `vision-context-${Date.now()}`,
              label: "视觉上下文",
              detail: `${context.model ?? "model"}，${formatBytes(context.sizeBytes)}，已注入语音会话`,
            },
            ...current,
          ].slice(0, 5),
        );
        return context.summary;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "视觉上下文生成失败。";
        setVisionContextStatus(message);
        setMessages((current) =>
          keepMessageHistory([
            ...current,
            {
              id: `vision-context-error-${Date.now()}`,
              role: "system",
              content: message,
              status: "complete",
            } satisfies ChatMessage,
          ]),
        );
        return undefined;
      }
    },
    [
      clientConfig,
      connectionState,
      hasVideo,
      injectVisionContext,
      isPipelineMode,
      stream,
      visionContext,
    ],
  );

  async function handleStart() {
    setSessionState("connecting");
    setMessages((current) =>
      keepMessageHistory([
        ...current,
        {
          id: `media-request-${Date.now()}`,
          role: "system",
          content: "正在请求摄像头和麦克风权限。音视频不会上传到服务器。",
          status: "complete",
        } satisfies ChatMessage,
      ]),
    );

    const result = await startMedia();

    if (result.ok) {
      setSessionState("listening");
      appendInteraction("listening", "start");
      return;
    }

    setSessionState("error");
    setMessages((current) =>
      keepMessageHistory([
        ...current,
        {
          id: `media-error-${Date.now()}`,
          role: "system",
          content: result.errorMessage,
          status: "complete",
        } satisfies ChatMessage,
      ]),
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
    disconnectRealtime();
    voicePipeline.stop();
    stopMedia();
    setIsMuted(false);
    setSessionState("idle");
    appendInteraction("idle", "stop");
  }

  function handleDisconnectRealtime() {
    disconnectRealtime();
    setSessionState(stream ? "listening" : "idle");
    setTimeline((current) =>
      [
        {
          id: `realtime-disconnected-${Date.now()}`,
          label: "Realtime",
          detail: "WebRTC 语音连接已断开",
        },
        ...current,
      ].slice(0, 5),
    );
  }

  function handleCancelRealtimeResponse() {
    cancelResponse();
    setSessionState("listening");
    setTimeline((current) =>
      [
        {
          id: `realtime-cancel-${Date.now()}`,
          label: "中断",
          detail: "已请求取消当前 AI 语音回复",
        },
        ...current,
      ].slice(0, 5),
    );
  }

  async function handleConnectRealtime() {
    if (!stream || !hasAudio) {
      setSessionState("error");
      setMessages((current) =>
        keepMessageHistory([
          ...current,
          {
            id: `realtime-no-audio-${Date.now()}`,
            role: "system",
            content: "请先开始本地麦克风采集，再连接实时语音。",
            status: "complete",
          } satisfies ChatMessage,
        ]),
      );
      return;
    }

    setSessionState("connecting");
    setMessages((current) =>
      keepMessageHistory([
        ...current,
        {
          id: `realtime-connect-${Date.now()}`,
          role: "system",
          content: "正在创建 Realtime WebRTC 连接。",
          status: "complete",
        } satisfies ChatMessage,
      ]),
    );

    const result = await connectRealtime(stream, clientConfig);

    if (!result.ok) {
      const realtimeErrorMessage =
        result.errorMessage ?? "Realtime WebRTC 连接失败。";
      setSessionState("error");
      setMessages((current) =>
        keepMessageHistory([
          ...current,
          {
            id: `realtime-error-${Date.now()}`,
            role: "system",
            content: realtimeErrorMessage,
            status: "complete",
          } satisfies ChatMessage,
        ]),
      );
      return;
    }

    setSessionState("listening");
    setTimeline((current) =>
      [
        {
          id: `realtime-connected-${Date.now()}`,
          label: "Realtime",
          detail: "WebRTC 音频连接已建立",
        },
        ...current,
      ].slice(0, 5),
    );
  }

  async function handleAnalyzeFrame() {
    if (!videoRef.current || !stream || !hasVideo) {
      setFrameError("请先开始摄像头采集，再分析画面。");
      return;
    }

    setSessionState("thinking");
    setFrameError(null);
    setVisionAnalysis(null);
    setVisionModel(null);
    setIsVisionLoading(true);

    try {
      const frame = await captureCompressedFrame(videoRef.current);
      setLatestFrame(frame);
      setMessages((current) =>
        keepMessageHistory([
          ...current,
          {
            id: `frame-${Date.now()}`,
            role: "user",
            content: `问题：${visionQuestion.trim() || defaultVisionQuestion}\n已本地抽帧：${frame.width}x${frame.height}，${formatBytes(frame.sizeBytes)}。`,
            status: "complete",
          } satisfies ChatMessage,
        ]),
      );
      const response = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: frame.dataUrl,
          openai: clientConfig,
          question: visionQuestion,
        }),
      });
      const payload = (await response.json()) as VisionApiResponse;

      if (!response.ok || !payload.analysis) {
        throw new Error(payload.error ?? "视觉分析请求失败。");
      }

      const analysis = payload.analysis;

      setVisionAnalysis(analysis);
      setVisionModel(payload.model ?? null);
      setSessionState("listening");
      setMessages((current) =>
        keepMessageHistory([
          ...current,
          {
            id: `vision-${Date.now()}`,
            role: "assistant",
            content: analysis,
            status: "complete",
          } satisfies ChatMessage,
        ]),
      );
      setTimeline((current) =>
        [
          {
            id: `frame-timeline-${Date.now()}`,
            label: "视觉分析",
            detail: `${payload.model ?? "model"}，${formatBytes(frame.sizeBytes)}`,
          },
          ...current,
        ].slice(0, 5),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "抽帧失败。";
      setSessionState("error");
      setFrameError(message);
      setMessages((current) =>
        keepMessageHistory([
          ...current,
          {
            id: `frame-error-${Date.now()}`,
            role: "system",
            content: message,
            status: "complete",
          } satisfies ChatMessage,
        ]),
      );
    } finally {
      setIsVisionLoading(false);
    }
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

  useEffect(() => {
    if (isPipelineMode) {
      return;
    }

    if (!latestUserTranscript) {
      return;
    }

    if (handledTranscriptIdsRef.current.has(latestUserTranscript.id)) {
      return;
    }

    handledTranscriptIdsRef.current.add(latestUserTranscript.id);

    if (!shouldUseVisionForTranscript(latestUserTranscript.text)) {
      queueMicrotask(() => {
        setVisionContextStatus("最近语音问题未触发视觉上下文。");
      });
      return;
    }

    queueMicrotask(() => {
      void analyzeAndInjectVisionContext(latestUserTranscript.text, "voice");
    });
  }, [analyzeAndInjectVisionContext, isPipelineMode, latestUserTranscript]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Audai</p>
          <h1>AI 视觉对话助手</h1>
        </div>
        <nav className="topbar-menu" aria-label="应用菜单">
          <span className="build-tag">{clientConfig.visionModel}</span>
          <button onClick={() => setActiveMenu("status")} type="button">
            状态
          </button>
          <button onClick={() => setActiveMenu("logs")} type="button">
            日志
          </button>
          <button onClick={() => setActiveMenu("cost")} type="button">
            成本
          </button>
          <button onClick={onOpenSettings} type="button">
            设置
          </button>
        </nav>
      </header>

      <section className="workspace" aria-label="对话工作区">
        <div className="video-panel">
          <div className="video-frame">
            <audio ref={remoteAudioRef} aria-label="Realtime 远端语音播放" autoPlay />
            <video
              ref={videoRef}
              aria-label="本地摄像头预览"
              autoPlay
              muted
              playsInline
            />

            <div className={`video-status state-${displayedSessionState}`}>
              <span className="pulse" />
              <span>{sessionLabels[displayedSessionState]}</span>
            </div>

            <div className="video-overlay">
              <strong>
                {errorMessage ?? sessionDescriptions[displayedSessionState]}
              </strong>
              <span>
                {stream
                  ? "摄像头和麦克风在本地采集；连接语音后麦克风会通过 WebRTC 发送到 Realtime。"
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
            {isPipelineMode ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    voicePipeline.start({
                      clientConfig,
                      onAnswer: appendPipelineExchange,
                      onFinalTranscript: async (text) => {
                        if (!shouldUseVisionForTranscript(text)) {
                          return undefined;
                        }

                        return analyzeAndInjectVisionContext(text, "voice");
                      },
                    })
                  }
                  disabled={!stream || !hasAudio || sessionState === "connecting"}
                >
                  {voicePipeline.state === "listening" ? "语音监听中" : "开始语音"}
                </button>
                <button type="button" onClick={voicePipeline.stop}>
                  停止语音
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleConnectRealtime}
                  disabled={
                    !stream ||
                    !hasAudio ||
                    connectionState === "connecting" ||
                    connectionState === "connected"
                  }
                >
                  {connectionState === "connected" ? "语音已连接" : "连接语音"}
                </button>
                <button
                  type="button"
                  onClick={handleCancelRealtimeResponse}
                  disabled={
                    connectionState !== "connected" ||
                    turnState !== "assistant_speaking"
                  }
                >
                  中断回复
                </button>
                <button
                  type="button"
                  onClick={handleDisconnectRealtime}
                  disabled={connectionState !== "connected"}
                >
                  断开语音
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleAnalyzeFrame}
              disabled={!stream || !hasVideo || isVisionLoading || sessionState === "error"}
            >
              {isVisionLoading ? "分析中" : "分析画面"}
            </button>
            <button
              type="button"
              onClick={() => {
                const question = latestUserTranscript?.text ?? visionQuestion;

                void (async () => {
                  const visualContext = await analyzeAndInjectVisionContext(
                    question,
                    "manual",
                  );

                  if (isPipelineMode) {
                    const visualContextText = visualContext ?? undefined;
                    await voicePipeline.ask({
                      clientConfig,
                      message: question,
                      visualContext: visualContextText,
                      onAnswer: (answer) => appendPipelineExchange(question, answer),
                    });
                  }
                })();
              }}
              disabled={
                !stream ||
                !hasVideo ||
                (!isPipelineMode && connectionState !== "connected") ||
                isVisionLoading
              }
            >
              发送上下文
            </button>
            <button type="button" onClick={() => handleAction("fail")}>
              标记异常
            </button>
            <button
              type="button"
              onClick={handleStop}
              disabled={!stream && sessionState === "idle"}
            >
              停止
            </button>
          </div>

          <label className="vision-question" htmlFor="vision-question">
            <span>视觉问题</span>
            <textarea
              id="vision-question"
              maxLength={500}
              onChange={(event) => setVisionQuestion(event.target.value)}
              rows={3}
              value={visionQuestion}
            />
          </label>

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

        {activeMenu ? (
          <div className="menu-backdrop" role="presentation">
            <aside className="menu-drawer" aria-label="控制台菜单">
              <div className="menu-drawer-header">
                <div>
                  <p className="eyebrow">Console</p>
                  <h2>
                    {activeMenu === "status"
                      ? "状态"
                      : activeMenu === "logs"
                        ? "日志"
                        : "成本"}
                  </h2>
                </div>
                <button onClick={() => setActiveMenu(null)} type="button">
                  关闭
                </button>
              </div>

              {activeMenu === "status" ? (
                <>
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

          <section className="frame-panel" aria-label="抽帧结果">
            <div className="frame-panel-header">
              <strong>最近抽帧</strong>
              <span>{latestFrame ? formatBytes(latestFrame.sizeBytes) : "暂无"}</span>
            </div>

            {latestFrame ? (
              <>
                <div
                  aria-label="最近一次本地抽帧预览"
                  className="frame-preview"
                  role="img"
                  style={{ backgroundImage: `url(${latestFrame.dataUrl})` }}
                />
                <dl>
                  <div>
                    <dt>压缩尺寸</dt>
                    <dd>
                      {latestFrame.width} x {latestFrame.height}
                    </dd>
                  </div>
                  <div>
                    <dt>原始尺寸</dt>
                    <dd>
                      {latestFrame.originalWidth} x {latestFrame.originalHeight}
                    </dd>
                  </div>
                  <div>
                    <dt>格式</dt>
                    <dd>{latestFrame.mimeType}</dd>
                  </div>
                  <div>
                    <dt>质量</dt>
                    <dd>{Math.round(latestFrame.quality * 100)}%</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p>{frameError ?? "开始摄像头采集后，可点击分析画面生成本地压缩帧。"}</p>
            )}
          </section>

          <section className="vision-result" aria-label="视觉分析结果">
            <div className="frame-panel-header">
              <strong>视觉结果</strong>
              <span>{visionModel ?? "待分析"}</span>
            </div>
            <p>
              {isVisionLoading
                ? "正在分析本地压缩帧。"
                : visionAnalysis ?? frameError ?? "分析画面后，这里会显示模型返回的视觉理解结果。"}
            </p>
          </section>

          <section className="vision-context-panel" aria-label="语音视觉上下文">
            <div className="frame-panel-header">
              <strong>语音视觉上下文</strong>
              <span>
                {isFreshVisionContext(visionContext) ? "缓存可用" : "待生成"}
              </span>
            </div>
            <p>{visionContextStatus}</p>
            {visionContext ? (
              <dl>
                <div>
                  <dt>问题</dt>
                  <dd>{visionContext.question}</dd>
                </div>
                <div>
                  <dt>体积</dt>
                  <dd>{formatBytes(visionContext.sizeBytes)}</dd>
                </div>
              </dl>
            ) : null}
          </section>
                </>
              ) : null}

              {activeMenu === "cost" ? (
          <section className="cost-panel" aria-label="成本控制">
            <div className="frame-panel-header">
              <strong>成本控制</strong>
              <span>按需调用</span>
            </div>
            <dl>
              <div>
                <dt>视觉请求</dt>
                <dd>{visionRequestCount} 次</dd>
              </div>
              <div>
                <dt>缓存命中</dt>
                <dd>{visionCacheHitCount} 次</dd>
              </div>
              <div>
                <dt>最近图片</dt>
                <dd>{latestFrame ? formatBytes(latestFrame.sizeBytes) : "暂无"}</dd>
              </div>
              <div>
                <dt>缓存窗口</dt>
                <dd>{Math.round(visionContextTtlMs / 1000)} 秒</dd>
              </div>
            </dl>
            <p>
              摄像头画面只在用户触发视觉问题时抽帧分析，默认低细节输入，并复用短期视觉摘要。
            </p>
          </section>
              ) : null}

              {activeMenu === "logs" ? (
                <>
          <section className="realtime-panel" aria-label="语音连接">
            <div className="frame-panel-header">
              <strong>{isPipelineMode ? "语音流水线" : "实时语音"}</strong>
              <span>
                {isPipelineMode
                  ? voicePipeline.state
                  : getRealtimeStatus(connectionState)}
              </span>
            </div>
            {isPipelineMode ? (
              <dl>
                <div>
                  <dt>STT</dt>
                  <dd>浏览器语音识别</dd>
                </div>
                <div>
                  <dt>LLM</dt>
                  <dd>{voicePipeline.model ?? clientConfig.chatModel}</dd>
                </div>
                <div>
                  <dt>TTS</dt>
                  <dd>浏览器语音合成</dd>
                </div>
                <div>
                  <dt>模式</dt>
                  <dd>语音流水线</dd>
                </div>
              </dl>
            ) : (
              <dl>
                <div>
                  <dt>模型</dt>
                  <dd>{realtimeModel ?? "待连接"}</dd>
                </div>
                <div>
                  <dt>声音</dt>
                  <dd>{realtimeVoice ?? "待连接"}</dd>
                </div>
                <div>
                  <dt>转写</dt>
                  <dd>{transcriptionModel ?? "待连接"}</dd>
                </div>
                <div>
                  <dt>插话</dt>
                  <dd>{interruptionCount} 次</dd>
                </div>
              </dl>
            )}
            <p>
              {isPipelineMode
                ? voicePipeline.errorMessage ??
                  "浏览器完成语音识别和语音播放，文本回复由 Responses API 生成。"
                : realtimeError ??
                  (connectionState === "connected"
                    ? `麦克风音频正在通过 WebRTC 发送，当前回合：${getRealtimeTurnStatus(turnState)}。`
                    : "开始本地采集后，可连接 Realtime 语音。")}
            </p>
            {isPipelineMode && (voicePipeline.lastTranscript || voicePipeline.lastAnswer) ? (
              <div className="transcript-list" aria-label="语音流水线转写">
                {voicePipeline.lastTranscript ? (
                  <article className="transcript-item transcript-user">
                    <span>用户</span>
                    <p>{voicePipeline.lastTranscript}</p>
                  </article>
                ) : null}
                {voicePipeline.lastAnswer ? (
                  <article className="transcript-item transcript-assistant">
                    <span>AI</span>
                    <p>{voicePipeline.lastAnswer}</p>
                  </article>
                ) : null}
              </div>
            ) : null}
            {!isPipelineMode && transcripts.length > 0 ? (
              <div className="transcript-list" aria-label="实时转写">
                {transcripts.slice(0, 4).map((transcript) => (
                  <article
                    className={`transcript-item transcript-${transcript.role}`}
                    key={transcript.id}
                  >
                    <span>
                      {transcript.role === "user" ? "用户" : "AI"}
                      {transcript.status === "streaming" ? " · 流式" : ""}
                    </span>
                    <p>{transcript.text}</p>
                  </article>
                ))}
              </div>
            ) : null}
            {!isPipelineMode && realtimeEvents.length > 0 ? (
              <ul>
                {realtimeEvents.slice(0, 4).map((event) => (
                  <li key={event.id} title={event.summary}>
                    {event.type}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

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
                </>
              ) : null}
            </aside>
          </div>
        ) : null}
      </section>
    </main>
  );
}
