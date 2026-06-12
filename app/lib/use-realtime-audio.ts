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
};

type RealtimeSessionResponse = {
  clientSecret?: string;
  expiresAt?: number | null;
  model?: string;
  voice?: string;
  error?: string;
};

export function useRealtimeAudio() {
  const [connectionState, setConnectionState] =
    useState<RealtimeConnectionState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [voice, setVoice] = useState<string | null>(null);
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

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
  }, []);

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
        }

        if (
          peerConnection.connectionState === "failed" ||
          peerConnection.connectionState === "disconnected"
        ) {
          setConnectionState("error");
          setErrorMessage("Realtime WebRTC 连接已断开。");
        }
      };

      dataChannel.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as { type?: string };
          setEvents((current) =>
            [
              {
                id: `${payload.type ?? "event"}-${Date.now()}`,
                type: payload.type ?? "unknown",
                receivedAt: new Date().toISOString(),
              },
              ...current,
            ].slice(0, 8),
          );
        } catch {
          setEvents((current) =>
            [
              {
                id: `raw-${Date.now()}`,
                type: "raw_message",
                receivedAt: new Date().toISOString(),
              },
              ...current,
            ].slice(0, 8),
          );
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
    [disconnect],
  );

  useEffect(() => disconnect, [disconnect]);

  return {
    connectionState,
    errorMessage,
    remoteStream,
    model,
    voice,
    events,
    connect,
    disconnect,
  };
}
