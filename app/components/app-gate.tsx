"use client";

import { useState } from "react";
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

function ConfigForm({ config, mode, onCancel, onClear, onSave }: ConfigFormProps) {
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const voiceMode = formData.get("voiceMode");

    onSave(
      normalizeClientConfig({
        ...config,
        apiKey: String(formData.get("apiKey") ?? ""),
        baseUrl: String(formData.get("baseUrl") ?? ""),
        chatModel: String(formData.get("chatModel") ?? config.chatModel),
        realtimeModel: String(
          formData.get("realtimeModel") ?? config.realtimeModel,
        ),
        realtimeTranscriptionModel: String(
          formData.get("realtimeTranscriptionModel") ??
            config.realtimeTranscriptionModel,
        ),
        realtimeVoice: String(
          formData.get("realtimeVoice") ?? config.realtimeVoice,
        ),
        visionModel: String(formData.get("visionModel") ?? config.visionModel),
        voiceMode: voiceMode === "realtime" ? "realtime" : "pipeline",
      }),
    );
  }

  return (
    <form className="config-form" onSubmit={handleSubmit}>
      <div className="config-grid">
        <label>
          <span>OpenAI API Key</span>
          <input
            autoComplete="off"
            defaultValue={config.apiKey}
            name="apiKey"
            placeholder="sk-..."
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
              >
                <option value="pipeline">语音流水线</option>
                <option value="realtime">OpenAI Realtime</option>
              </select>
            </label>
            <label>
              <span>视觉模型</span>
              <input
                defaultValue={config.visionModel}
                name="visionModel"
              />
            </label>
            <label>
              <span>聊天模型</span>
              <input
                defaultValue={config.chatModel}
                name="chatModel"
              />
            </label>
            <label>
              <span>Realtime 模型</span>
              <input
                defaultValue={config.realtimeModel}
                name="realtimeModel"
              />
            </label>
            <label>
              <span>Realtime 声音</span>
              <input
                defaultValue={config.realtimeVoice}
                name="realtimeVoice"
              />
            </label>
            <label>
              <span>语音转写模型</span>
              <input
                defaultValue={config.realtimeTranscriptionModel}
                name="realtimeTranscriptionModel"
              />
            </label>
          </>
        ) : null}
      </div>

      <div className="config-actions">
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
        <button className="primary-button" type="submit">
          保存并进入
        </button>
      </div>
    </form>
  );
}

export function AppGate() {
  const [config, setConfig] = useState<ClientConfig>(() => loadClientConfig());
  const [showSettings, setShowSettings] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const isReady = isClientConfigReady(config);

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
