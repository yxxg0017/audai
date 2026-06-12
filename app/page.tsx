const statusItems = [
  { label: "摄像头", value: "待连接" },
  { label: "麦克风", value: "待连接" },
  { label: "实时会话", value: "未开始" },
  { label: "视觉分析", value: "未触发" },
];

const timelineItems = [
  "应用骨架已就绪",
  "媒体采集将在后续 PR 接入",
  "实时语音将在 WebRTC PR 接入",
];

export default function Home() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Audai</p>
          <h1>AI 视觉对话助手</h1>
        </div>
        <div className="build-tag">PR 1</div>
      </header>

      <section className="workspace" aria-label="对话工作区">
        <div className="video-panel">
          <div className="video-frame">
            <div className="video-status">
              <span className="pulse" />
              <span>等待媒体权限</span>
            </div>
          </div>

          <div className="control-bar" aria-label="会话控制">
            <button type="button" disabled>
              开始
            </button>
            <button type="button" disabled>
              静音
            </button>
            <button type="button" disabled>
              分析画面
            </button>
            <button type="button" disabled>
              停止
            </button>
          </div>
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

          <div className="timeline">
            {timelineItems.map((item) => (
              <div className="timeline-row" key={item}>
                <span className="dot" />
                <p>{item}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
