"use client";

import { useEffect, useRef, useState } from "react";
import {
  clearClientConfig,
  defaultClientConfig,
  isClientConfigReady,
  loadClientConfig,
  normalizeClientConfig,
  saveClientConfig,
  type ClientConfig,
} from "../lib/client-config";
import { ConversationWorkspace } from "./conversation-workspace";

type ConfigFormProps = {
  config: ClientConfig;
  mode: "gate" | "panel";
  onCancel?: () => void;
  onClear?: () => void;
  onSave: (config: ClientConfig) => void;
};

type ModelsApiResponse = {
  models?: string[];
  suggested?: Partial<ClientConfig>;
  error?: string;
};

function ConfigForm({ config, mode, onCancel, onClear, onSave }: ConfigFormProps) {
  const apiKeyRef = useRef<HTMLInputElement | null>(null);
  const baseUrlRef = useRef<HTMLInputElement | null>(null);
  const chatModelRef = useRef<HTMLInputElement | null>(null);
  const localSttUrlRef = useRef<HTMLInputElement | null>(null);
  const localTtsEngineRef = useRef<HTMLSelectElement | null>(null);
  const localTtsUrlRef = useRef<HTMLInputElement | null>(null);
  const localTtsVoiceRef = useRef<HTMLInputElement | null>(null);
  const localVoiceUrlRef = useRef<HTMLInputElement | null>(null);
  const realtimeModelRef = useRef<HTMLInputElement | null>(null);
  const realtimeTranscriptionModelRef = useRef<HTMLInputElement | null>(null);
  const realtimeVoiceRef = useRef<HTMLInputElement | null>(null);
  const sttProviderRef = useRef<HTMLSelectElement | null>(null);
  const ttsProviderRef = useRef<HTMLSelectElement | null>(null);
  const visionModelRef = useRef<HTMLInputElement | null>(null);
  const voiceModeRef = useRef<HTMLSelectElement | null>(null);
  const detectedConfigRef = useRef<Partial<ClientConfig>>({});
  const [modelDetectionStatus, setModelDetectionStatus] = useState<string | null>(
    null,
  );

  function readFormConfig() {
    return normalizeClientConfig({
      ...config,
      ...detectedConfigRef.current,
      apiKey: apiKeyRef.current?.value ?? config.apiKey,
      baseUrl: baseUrlRef.current?.value ?? config.baseUrl,
      chatModel:
        chatModelRef.current?.value ??
        detectedConfigRef.current.chatModel ??
        config.chatModel,
      localSttUrl:
        localSttUrlRef.current?.value ??
        detectedConfigRef.current.localSttUrl ??
        config.localSttUrl,
      localTtsEngine:
        localTtsEngineRef.current?.value === "piper" ? "piper" : "say",
      localTtsUrl:
        localTtsUrlRef.current?.value ??
        detectedConfigRef.current.localTtsUrl ??
        config.localTtsUrl,
      localTtsVoice:
        localTtsVoiceRef.current?.value ??
        detectedConfigRef.current.localTtsVoice ??
        config.localTtsVoice,
      localVoiceUrl:
        localVoiceUrlRef.current?.value ??
        detectedConfigRef.current.localVoiceUrl ??
        config.localVoiceUrl,
      realtimeModel:
        realtimeModelRef.current?.value ??
        detectedConfigRef.current.realtimeModel ??
        config.realtimeModel,
      realtimeTranscriptionModel:
        realtimeTranscriptionModelRef.current?.value ??
        detectedConfigRef.current.realtimeTranscriptionModel ??
        config.realtimeTranscriptionModel,
      realtimeVoice:
        realtimeVoiceRef.current?.value ??
        detectedConfigRef.current.realtimeVoice ??
        config.realtimeVoice,
      visionModel:
        visionModelRef.current?.value ??
        detectedConfigRef.current.visionModel ??
        config.visionModel,
      voiceMode:
        voiceModeRef.current?.value === "realtime" ? "realtime" : "pipeline",
      sttProvider:
        sttProviderRef.current?.value === "browser" ||
        sttProviderRef.current?.value === "local"
          ? sttProviderRef.current.value
          : "cloud",
      ttsProvider:
        ttsProviderRef.current?.value === "local" ? "local" : "browser",
    });
  }

  function applyConfigToVisibleFields(nextConfig: ClientConfig) {
    if (chatModelRef.current) {
      chatModelRef.current.value = nextConfig.chatModel;
    }

    if (visionModelRef.current) {
      visionModelRef.current.value = nextConfig.visionModel;
    }

    if (realtimeModelRef.current) {
      realtimeModelRef.current.value = nextConfig.realtimeModel;
    }

    if (realtimeTranscriptionModelRef.current) {
      realtimeTranscriptionModelRef.current.value =
        nextConfig.realtimeTranscriptionModel;
    }
  }

  async function detectModelsForConfig(currentConfig: ClientConfig) {
    if (!currentConfig.apiKey || !currentConfig.baseUrl) {
      throw new Error("请先填写 API Key 和 Base URL。");
    }

    const response = await fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openai: currentConfig }),
    });
    const payload = (await response.json()) as ModelsApiResponse;

    if (!response.ok || !payload.suggested) {
      throw new Error(payload.error ?? "模型检测失败。");
    }

    return {
      config: normalizeClientConfig({
        ...currentConfig,
        ...payload.suggested,
      }),
      modelCount: payload.models?.length ?? 0,
    };
  }

  async function handleDetectModels() {
    setModelDetectionStatus("正在读取模型列表...");

    try {
      const result = await detectModelsForConfig(readFormConfig());
      detectedConfigRef.current = result.config;
      applyConfigToVisibleFields(result.config);
      setModelDetectionStatus(
        `已读取 ${result.modelCount} 个模型，并自动选择可用候选。`,
      );
    } catch (error) {
      setModelDetectionStatus(
        error instanceof Error ? error.message : "模型检测失败。",
      );
    }
  }

  async function handleSave() {
    const currentConfig = readFormConfig();

    if (mode === "gate") {
      setModelDetectionStatus("正在检测模型并保存配置...");
      try {
        const result = await detectModelsForConfig(currentConfig);
        detectedConfigRef.current = result.config;
        setModelDetectionStatus(
          `已读取 ${result.modelCount} 个模型，并保存可用候选。`,
        );
        onSave(result.config);
        return;
      } catch (error) {
        setModelDetectionStatus(
          error instanceof Error
            ? `模型检测失败，已保留当前模型：${error.message}`
            : "模型检测失败，已保留当前模型。",
        );
      }
    }

    onSave(currentConfig);
  }

  return (
    <div className="config-form">
      <div className="config-grid">
        <label>
          <span>OpenAI API Key</span>
          <input
            autoComplete="off"
            defaultValue={config.apiKey}
            name="apiKey"
            placeholder="sk-..."
            ref={apiKeyRef}
            required
            type="password"
          />
        </label>
        <label>
          <span>Base URL</span>
          <input
            defaultValue={config.baseUrl}
            name="baseUrl"
            placeholder="https://api.openai.com/v1"
            ref={baseUrlRef}
            required
            type="url"
          />
        </label>
        {mode === "panel" ? (
          <>
            <label>
              <span>语音模式</span>
              <select
                defaultValue={config.voiceMode}
                name="voiceMode"
                ref={voiceModeRef}
              >
                <option value="pipeline">语音流水线</option>
                <option value="realtime">OpenAI Realtime</option>
              </select>
            </label>
            <label>
              <span>STT 来源</span>
              <select
                defaultValue={config.sttProvider}
                name="sttProvider"
                ref={sttProviderRef}
              >
                <option value="cloud">云端转写 API</option>
                <option value="local">本地 STT 模型</option>
                <option value="browser">浏览器识别</option>
              </select>
            </label>
            <label>
              <span>TTS 来源</span>
              <select
                defaultValue={config.ttsProvider}
                name="ttsProvider"
                ref={ttsProviderRef}
              >
                <option value="browser">浏览器语音合成</option>
                <option value="local">本地 TTS 模型</option>
              </select>
            </label>
            <label>
              <span>视觉模型</span>
              <input
                defaultValue={config.visionModel}
                name="visionModel"
                ref={visionModelRef}
              />
            </label>
            <label>
              <span>聊天模型</span>
              <input
                defaultValue={config.chatModel}
                name="chatModel"
                ref={chatModelRef}
              />
            </label>
            <label>
              <span>本地 STT 地址</span>
              <input
                defaultValue={config.localSttUrl}
                name="localSttUrl"
                placeholder="http://127.0.0.1:8765/stt"
                ref={localSttUrlRef}
                type="url"
              />
            </label>
            <label>
              <span>本地 TTS 引擎</span>
              <select
                defaultValue={config.localTtsEngine}
                name="localTtsEngine"
                ref={localTtsEngineRef}
              >
                <option value="say">macOS say 兜底</option>
                <option value="piper">Piper 本地声线</option>
              </select>
            </label>
            <label>
              <span>本地 TTS 地址</span>
              <input
                defaultValue={config.localTtsUrl}
                name="localTtsUrl"
                placeholder="http://127.0.0.1:8765/tts"
                ref={localTtsUrlRef}
                type="url"
              />
            </label>
            <label>
              <span>本地 TTS 声音</span>
              <input
                defaultValue={config.localTtsVoice}
                name="localTtsVoice"
                placeholder="say 声音名或 Piper .onnx 模型路径"
                ref={localTtsVoiceRef}
              />
            </label>
            <label>
              <span>本地语音会话地址</span>
              <input
                defaultValue={config.localVoiceUrl}
                name="localVoiceUrl"
                placeholder="/api/local-voice/turn"
                ref={localVoiceUrlRef}
              />
            </label>
            <label>
              <span>Realtime 模型</span>
              <input
                defaultValue={config.realtimeModel}
                name="realtimeModel"
                ref={realtimeModelRef}
              />
            </label>
            <label>
              <span>Realtime 声音</span>
              <input
                defaultValue={config.realtimeVoice}
                name="realtimeVoice"
                ref={realtimeVoiceRef}
              />
            </label>
            <label>
              <span>语音转写模型</span>
              <input
                defaultValue={config.realtimeTranscriptionModel}
                name="realtimeTranscriptionModel"
                ref={realtimeTranscriptionModelRef}
              />
            </label>
          </>
        ) : null}
      </div>

      <div className="config-actions">
        <button onClick={handleDetectModels} type="button">
          检测模型
        </button>
        {mode === "panel" ? (
          <button onClick={onCancel} type="button">
            取消
          </button>
        ) : null}
        {onClear ? (
          <button onClick={onClear} type="button">
            清除配置
          </button>
        ) : null}
        <button className="primary-button" onClick={handleSave} type="button">
          保存并进入
        </button>
      </div>
      {modelDetectionStatus ? (
        <p className="config-status">{modelDetectionStatus}</p>
      ) : null}
    </div>
  );
}

export function AppGate() {
  const [config, setConfig] = useState<ClientConfig>(defaultClientConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const isReady = isClientConfigReady(config);

  useEffect(() => {
    let isCancelled = false;

    window.setTimeout(() => {
      if (isCancelled) {
        return;
      }

      const storedConfig = loadClientConfig();
      const searchParams = new URLSearchParams(window.location.search);
      const apiKey = searchParams.get("apiKey");
      const baseUrl = searchParams.get("baseUrl");

      if (!apiKey && !baseUrl) {
        setConfig(storedConfig);
        return;
      }

      const nextConfig = normalizeClientConfig({
        ...storedConfig,
        apiKey: apiKey ?? storedConfig.apiKey,
        baseUrl: baseUrl ?? storedConfig.baseUrl,
      });

      try {
        saveClientConfig(nextConfig);
        setStorageWarning(null);
      } catch {
        setStorageWarning("当前浏览器无法写入 localStorage，本次配置只在当前页面会话中生效。");
      }

      window.history.replaceState(null, "", window.location.pathname);
      setConfig(nextConfig);
    }, 0);

    return () => {
      isCancelled = true;
    };
  }, []);

  function handleSave(nextConfig: ClientConfig) {
    try {
      saveClientConfig(nextConfig);
      setStorageWarning(null);
    } catch {
      // localStorage can fail in private mode or restricted browser contexts.
      // Keep the in-memory config so the user can still enter the app.
      setStorageWarning("当前浏览器无法写入 localStorage，本次配置只在当前页面会话中生效。");
    }
    setConfig(nextConfig);
    setShowSettings(false);
  }

  function handleClear() {
    try {
      clearClientConfig();
      setStorageWarning(null);
    } catch {
      setStorageWarning("当前浏览器无法清除 localStorage，请手动清理站点数据。");
    }
    setConfig(defaultClientConfig);
    setShowSettings(false);
  }

  if (!isReady) {
    return (
      <main className="config-shell">
        <section className="config-card">
          <p className="eyebrow">Audai</p>
          <h1>配置 OpenAI 连接</h1>
          <p className="config-copy">
            API Key 和 Base URL 会保存到当前浏览器的 localStorage。保存后下次进入页面无需再次输入。
          </p>
          {storageWarning ? <p className="config-warning">{storageWarning}</p> : null}
          <ConfigForm
            config={config}
            key={`${config.apiKey}:${config.baseUrl}:gate`}
            mode="gate"
            onSave={handleSave}
          />
        </section>
      </main>
    );
  }

  return (
    <>
      <ConversationWorkspace
        clientConfig={config}
        onOpenSettings={() => setShowSettings(true)}
      />
      {showSettings ? (
        <div className="settings-backdrop" role="presentation">
          <section className="settings-panel" aria-label="配置管理">
            <div className="settings-header">
              <div>
                <p className="eyebrow">Settings</p>
                <h2>配置管理</h2>
              </div>
              <button onClick={() => setShowSettings(false)} type="button">
                关闭
              </button>
            </div>
            {storageWarning ? <p className="config-warning">{storageWarning}</p> : null}
            <ConfigForm
              config={config}
              key={`${config.apiKey}:${config.baseUrl}:${config.voiceMode}:panel`}
              mode="panel"
              onCancel={() => setShowSettings(false)}
              onClear={handleClear}
              onSave={handleSave}
            />
          </section>
        </div>
      ) : null}
    </>
  );
}
