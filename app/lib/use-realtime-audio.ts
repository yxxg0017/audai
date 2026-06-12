"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
    async (localStream: MediaStream) => {
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
        "https://api.openai.com/v1/realtime/calls",
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
    connect,
    disconnect,
  };
}
