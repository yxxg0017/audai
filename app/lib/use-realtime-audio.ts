"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientConfig } from "./client-config";

export type RealtimeConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

export type RealtimeEvent = {
  id: string;
  type: string;
  receivedAt: string;
  summary: string;
};

export type RealtimeTurnState =
  | "idle"
  | "listening"
  | "user_speaking"
  | "thinking"
  | "assistant_speaking"
  | "interrupted"
  | "error";

export type RealtimeTranscript = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "streaming" | "complete";
  updatedAt: string;
};

type RealtimeSessionResponse = {
  clientSecret?: string;
  expiresAt?: number | null;
  model?: string;
  voice?: string;
  transcriptionModel?: string;
  error?: string;
};

type RealtimeServerEvent = {
  type?: string;
  event_id?: string;
  item_id?: string;
  response_id?: string;
  transcript?: string;
  delta?: string;
  error?: {
    message?: string;
  };
};

type RealtimeClientEvent = {
  type: string;
  [key: string]: unknown;
};

type VisionContextPayload = {
  userQuestion: string;
  summary: string;
};

function getEventSummary(payload: RealtimeServerEvent) {
  if (payload.error?.message) {
    return payload.error.message;
  }

  if (payload.transcript) {
    return payload.transcript;
  }

  if (payload.delta) {
    return payload.delta;
  }

  return payload.type ?? "unknown";
}

function toRealtimeCallsUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, "")}/realtime/calls`;
}

export function useRealtimeAudio() {
  const [connectionState, setConnectionState] =
    useState<RealtimeConnectionState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [voice, setVoice] = useState<string | null>(null);
  const [transcriptionModel, setTranscriptionModel] = useState<string | null>(
    null,
  );
  const [turnState, setTurnStateState] = useState<RealtimeTurnState>("idle");
  const [interruptionCount, setInterruptionCount] = useState(0);
  const [transcripts, setTranscripts] = useState<RealtimeTranscript[]>([]);
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const turnStateRef = useRef<RealtimeTurnState>("idle");

  const setTurnState = useCallback((nextState: RealtimeTurnState) => {
    turnStateRef.current = nextState;
    setTurnStateState(nextState);
  }, []);

  const appendEvent = useCallback((payload: RealtimeServerEvent) => {
    setEvents((current) =>
      [
        {
          id: payload.event_id ?? `${payload.type ?? "event"}-${Date.now()}`,
          type: payload.type ?? "unknown",
          receivedAt: new Date().toISOString(),
          summary: getEventSummary(payload),
        },
        ...current,
      ].slice(0, 12),
    );
  }, []);

  const upsertTranscript = useCallback(
    (nextTranscript: Omit<RealtimeTranscript, "updatedAt">) => {
      setTranscripts((current) => {
        const updatedAt = new Date().toISOString();
        const existingIndex = current.findIndex(
          (item) => item.id === nextTranscript.id,
        );

        if (existingIndex === -1) {
          return [{ ...nextTranscript, updatedAt }, ...current].slice(0, 8);
        }

        return current.map((item, index) =>
          index === existingIndex
            ? {
                ...item,
                text:
                  nextTranscript.status === "streaming"
                    ? `${item.text}${nextTranscript.text}`
                    : nextTranscript.text,
                status: nextTranscript.status,
                updatedAt,
              }
            : item,
        );
      });
    },
    [],
  );

  const cancelResponse = useCallback(() => {
    const dataChannel = dataChannelRef.current;

    if (!dataChannel || dataChannel.readyState !== "open") {
      return;
    }

    dataChannel.send(JSON.stringify({ type: "response.cancel" }));
  }, []);

  const sendClientEvent = useCallback((payload: RealtimeClientEvent) => {
    const dataChannel = dataChannelRef.current;

    if (!dataChannel || dataChannel.readyState !== "open") {
      setErrorMessage("Realtime data channel 尚未就绪，无法发送上下文。");
      return false;
    }

    dataChannel.send(JSON.stringify(payload));
    appendEvent({
      type: `client.${payload.type}`,
      event_id:
        typeof payload.event_id === "string" ? payload.event_id : undefined,
    });
    return true;
  }, [appendEvent]);

  const injectVisionContext = useCallback(
    ({ summary, userQuestion }: VisionContextPayload) => {
      const trimmedSummary = summary.trim();
      const trimmedQuestion = userQuestion.trim();

      if (!trimmedSummary || !trimmedQuestion) {
        setErrorMessage("视觉上下文或用户问题为空，无法注入 Realtime 会话。");
        return false;
      }

      if (turnStateRef.current === "assistant_speaking") {
        cancelResponse();
        setInterruptionCount((current) => current + 1);
      }

      const contextText = [
        "以下是用户当前摄像头画面的视觉上下文，请结合它回答用户刚才的语音问题。",
        `用户语音问题：${trimmedQuestion}`,
        `视觉上下文：${trimmedSummary}`,
        "回答要求：使用简洁中文，优先回答用户问题，不要提到你收到了额外上下文。",
      ].join("\n");
      const eventId = `vision-context-${Date.now()}`;
      const itemCreated = sendClientEvent({
        type: "conversation.item.create",
        event_id: eventId,
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: contextText,
            },
          ],
        },
      });

      if (!itemCreated) {
        return false;
      }

      return sendClientEvent({
        type: "response.create",
        event_id: `vision-response-${Date.now()}`,
        response: {
          instructions: "请结合最新视觉上下文回答用户刚才的问题。",
        },
      });
    },
    [cancelResponse, sendClientEvent],
  );

  const handleRealtimeEvent = useCallback(
    (payload: RealtimeServerEvent) => {
      appendEvent(payload);

      switch (payload.type) {
        case "input_audio_buffer.speech_started": {
          if (turnStateRef.current === "assistant_speaking") {
            cancelResponse();
            setInterruptionCount((current) => current + 1);
            setTurnState("interrupted");
            return;
          }

          setTurnState("user_speaking");
          return;
        }

        case "input_audio_buffer.speech_stopped":
        case "input_audio_buffer.committed":
          setTurnState("thinking");
          return;

        case "conversation.item.input_audio_transcription.completed": {
          const transcript = payload.transcript?.trim();

          if (transcript) {
            upsertTranscript({
              id: payload.item_id ?? `user-${Date.now()}`,
              role: "user",
              text: transcript,
              status: "complete",
            });
          }

          setTurnState("thinking");
          return;
        }

        case "conversation.item.input_audio_transcription.failed":
          setErrorMessage("用户语音转写失败，请重试。");
          setTurnState("error");
          return;

        case "response.created":
        case "response.output_item.added":
          setTurnState("thinking");
          return;

        case "response.audio.delta":
          setTurnState("assistant_speaking");
          return;

        case "response.audio_transcript.delta":
        case "response.output_audio_transcript.delta": {
          const delta = payload.delta ?? "";

          if (delta) {
            upsertTranscript({
              id:
                payload.item_id ??
                payload.response_id ??
                `assistant-${Date.now()}`,
              role: "assistant",
              text: delta,
              status: "streaming",
            });
          }

          setTurnState("assistant_speaking");
          return;
        }

        case "response.audio_transcript.done":
        case "response.output_audio_transcript.done": {
          const transcript = payload.transcript?.trim();

          if (transcript) {
            upsertTranscript({
              id:
                payload.item_id ??
                payload.response_id ??
                `assistant-${Date.now()}`,
              role: "assistant",
              text: transcript,
              status: "complete",
            });
          }

          setTurnState("listening");
          return;
        }

        case "response.done":
        case "response.audio.done":
        case "response.cancelled":
          setTurnState("listening");
          return;

        case "error":
          setErrorMessage(payload.error?.message ?? "Realtime 事件处理失败。");
          setConnectionState("error");
          setTurnState("idle");
          return;

        default:
          return;
      }
    },
    [appendEvent, cancelResponse, setTurnState, upsertTranscript],
  );

  const disconnect = useCallback(() => {
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    setRemoteStream((current) => {
      current?.getTracks().forEach((track) => track.stop());
      return null;
    });
    setConnectionState((current) =>
      current === "idle" ? "idle" : "closed",
    );
    setTurnState("idle");
  }, [setTurnState]);

  const connect = useCallback(
    async (localStream: MediaStream, clientConfig: ClientConfig) => {
      const audioTrack = localStream.getAudioTracks()[0];

      if (!audioTrack) {
        setErrorMessage("未找到可用于 Realtime 的麦克风轨道。");
        setConnectionState("error");
        return { ok: false, errorMessage: "未找到可用于 Realtime 的麦克风轨道。" };
      }

      disconnect();
      setConnectionState("connecting");
      setErrorMessage(null);
      setEvents([]);
      setTranscripts([]);
      setInterruptionCount(0);
      setTurnState("idle");

      const tokenResponse = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openai: clientConfig,
        }),
      });
      const tokenPayload =
        (await tokenResponse.json()) as RealtimeSessionResponse;

      if (!tokenResponse.ok || !tokenPayload.clientSecret) {
        const message =
          tokenPayload.error ?? "Realtime 临时会话创建失败。";
        setErrorMessage(message);
        setConnectionState("error");
        return { ok: false, errorMessage: message };
      }

      setModel(tokenPayload.model ?? null);
      setVoice(tokenPayload.voice ?? null);
      setTranscriptionModel(tokenPayload.transcriptionModel ?? null);

      const peerConnection = new RTCPeerConnection();
      const dataChannel = peerConnection.createDataChannel("oai-events");
      const nextRemoteStream = new MediaStream();

      peerConnectionRef.current = peerConnection;
      dataChannelRef.current = dataChannel;
      setRemoteStream(nextRemoteStream);

      peerConnection.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach((track) => {
          nextRemoteStream.addTrack(track);
        });
        setRemoteStream(nextRemoteStream);
      };

      peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === "connected") {
          setConnectionState("connected");
          setTurnState("listening");
        }

        if (
          peerConnection.connectionState === "failed" ||
          peerConnection.connectionState === "disconnected"
        ) {
          setConnectionState("error");
          setErrorMessage("Realtime WebRTC 连接已断开。");
          setTurnState("idle");
        }
      };

      dataChannel.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as RealtimeServerEvent;
          handleRealtimeEvent(payload);
        } catch {
          appendEvent({ type: "raw_message" });
        }
      };

      peerConnection.addTrack(audioTrack, localStream);

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const sdpResponse = await fetch(
        toRealtimeCallsUrl(clientConfig.baseUrl),
        {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${tokenPayload.clientSecret}`,
            "Content-Type": "application/sdp",
          },
        },
      );

      if (!sdpResponse.ok) {
        const message = await sdpResponse.text();
        disconnect();
        setConnectionState("error");
        setErrorMessage(message || "Realtime SDP 握手失败。");
        return { ok: false, errorMessage: message || "Realtime SDP 握手失败。" };
      }

      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: await sdpResponse.text(),
      });

      setConnectionState("connected");
      return { ok: true };
    },
    [appendEvent, disconnect, handleRealtimeEvent, setTurnState],
  );

  useEffect(() => disconnect, [disconnect]);

  return {
    connectionState,
    errorMessage,
    remoteStream,
    model,
    voice,
    transcriptionModel,
    turnState,
    interruptionCount,
    transcripts,
    events,
    cancelResponse,
    injectVisionContext,
    connect,
    disconnect,
  };
}
