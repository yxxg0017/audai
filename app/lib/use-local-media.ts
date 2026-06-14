"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type MediaPermissionState = "idle" | "requesting" | "active" | "blocked" | "error";

export type LocalMediaStatus = {
  permissionState: MediaPermissionState;
  stream: MediaStream | null;
  audioLevel: number;
  errorMessage: string | null;
  facingMode: CameraFacingMode;
  hasVideo: boolean;
  hasAudio: boolean;
};

export type StartMediaResult =
  | { ok: true }
  | { ok: false; errorMessage: string };

export type CameraFacingMode = "user" | "environment";

function createMediaConstraints(facingMode: CameraFacingMode): MediaStreamConstraints {
  return {
    video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
      facingMode: { ideal: facingMode },
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  };
}

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
  switchCamera: () => Promise<StartMediaResult>;
} {
  const [permissionState, setPermissionState] =
    useState<MediaPermissionState>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<CameraFacingMode>("user");
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
    streamRef.current = null;
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

  const startMediaWithFacingMode = useCallback(async (
    nextFacingMode: CameraFacingMode,
  ): Promise<StartMediaResult> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      const isSecureContext = window.isSecureContext;
      const protocol = window.location.protocol;
      const host = window.location.host;
      const unsupportedMessage =
        isSecureContext
          ? "当前浏览器不支持 getUserMedia，无法采集摄像头和麦克风。请使用 Chrome、Edge 或 Safari 的新版本。"
          : `当前访问地址 ${protocol}//${host} 不是浏览器认可的安全上下文，无法使用摄像头和麦克风。请改用 http://localhost:3000，或为局域网地址配置 HTTPS。`;
      setPermissionState("error");
      setErrorMessage(unsupportedMessage);
      return { ok: false, errorMessage: unsupportedMessage };
    }

    setPermissionState("requesting");
    setErrorMessage(null);

    try {
      const mediaStream =
        await navigator.mediaDevices.getUserMedia(
          createMediaConstraints(nextFacingMode),
        );
      setStream((currentStream) => {
        currentStream?.getTracks().forEach((track) => track.stop());
        return mediaStream;
      });
      streamRef.current = mediaStream;
      setFacingMode(nextFacingMode);
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

  const startMedia = useCallback(
    () => startMediaWithFacingMode(facingMode),
    [facingMode, startMediaWithFacingMode],
  );

  const switchCamera = useCallback(async (): Promise<StartMediaResult> => {
    const nextFacingMode = facingMode === "user" ? "environment" : "user";
    const wasActive = Boolean(streamRef.current);
    const result = await startMediaWithFacingMode(nextFacingMode);

    if (!result.ok && wasActive) {
      await startMediaWithFacingMode(facingMode);
    }

    return result;
  }, [facingMode, startMediaWithFacingMode]);

  useEffect(() => stopMedia, [stopMedia]);

  return {
    permissionState,
    stream,
    audioLevel,
    errorMessage,
    facingMode,
    hasVideo: Boolean(stream?.getVideoTracks().length),
    hasAudio: Boolean(stream?.getAudioTracks().length),
    startMedia,
    stopMedia,
    switchCamera,
  };
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
