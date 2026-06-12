"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type MediaPermissionState = "idle" | "requesting" | "active" | "blocked" | "error";

export type LocalMediaStatus = {
  permissionState: MediaPermissionState;
  stream: MediaStream | null;
  audioLevel: number;
  errorMessage: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
};

export type StartMediaResult =
  | { ok: true }
  | { ok: false; errorMessage: string };

const mediaConstraints: MediaStreamConstraints = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: "user",
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

function getMediaErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "摄像头或麦克风权限被拒绝，请在浏览器权限设置中允许访问。";
    }

    if (error.name === "NotFoundError") {
      return "未找到可用的摄像头或麦克风设备。";
    }

    if (error.name === "NotReadableError") {
      return "设备正被其他应用占用，请关闭占用后重试。";
    }
  }

  return "无法启动本地媒体采集，请检查浏览器和设备权限。";
}

export function useLocalMedia(): LocalMediaStatus & {
  startMedia: () => Promise<StartMediaResult>;
  stopMedia: () => void;
} {
  const [permissionState, setPermissionState] =
    useState<MediaPermissionState>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const stopAudioMeter = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setAudioLevel(0);
  }, []);

  const stopMedia = useCallback(() => {
    setStream((currentStream) => {
      currentStream?.getTracks().forEach((track) => track.stop());
      return null;
    });
    stopAudioMeter();
    setPermissionState("idle");
  }, [stopAudioMeter]);

  const startAudioMeter = useCallback((mediaStream: MediaStream) => {
    stopAudioMeter();

    const audioTrack = mediaStream.getAudioTracks()[0];
    if (!audioTrack) {
      setAudioLevel(0);
      return;
    }

    const AudioContextConstructor =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextConstructor) {
      setAudioLevel(0);
      return;
    }

    const audioContext = new AudioContextConstructor();
    const source = audioContext.createMediaStreamSource(mediaStream);
    const analyser = audioContext.createAnalyser();
    const samples = new Uint8Array(analyser.frequencyBinCount);

    analyser.fftSize = 256;
    source.connect(analyser);
    audioContextRef.current = audioContext;

    function updateLevel() {
      analyser.getByteTimeDomainData(samples);
      const sum = samples.reduce((total, sample) => {
        const normalized = (sample - 128) / 128;
        return total + normalized * normalized;
      }, 0);
      const rms = Math.sqrt(sum / samples.length);
      setAudioLevel(Math.min(1, rms * 3));
      animationFrameRef.current = requestAnimationFrame(updateLevel);
    }

    updateLevel();
  }, [stopAudioMeter]);

  const startMedia = useCallback(async (): Promise<StartMediaResult> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      const unsupportedMessage =
        "当前浏览器不支持 getUserMedia，无法采集摄像头和麦克风。";
      setPermissionState("error");
      setErrorMessage(unsupportedMessage);
      return { ok: false, errorMessage: unsupportedMessage };
    }

    setPermissionState("requesting");
    setErrorMessage(null);

    try {
      const mediaStream =
        await navigator.mediaDevices.getUserMedia(mediaConstraints);
      setStream((currentStream) => {
        currentStream?.getTracks().forEach((track) => track.stop());
        return mediaStream;
      });
      setPermissionState("active");
      startAudioMeter(mediaStream);
      return { ok: true };
    } catch (error) {
      const message = getMediaErrorMessage(error);
      setPermissionState(error instanceof DOMException && error.name === "NotAllowedError" ? "blocked" : "error");
      setErrorMessage(message);
      stopAudioMeter();
      return { ok: false, errorMessage: message };
    }
  }, [startAudioMeter, stopAudioMeter]);

  useEffect(() => stopMedia, [stopMedia]);

  return {
    permissionState,
    stream,
    audioLevel,
    errorMessage,
    hasVideo: Boolean(stream?.getVideoTracks().length),
    hasAudio: Boolean(stream?.getAudioTracks().length),
    startMedia,
    stopMedia,
  };
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
