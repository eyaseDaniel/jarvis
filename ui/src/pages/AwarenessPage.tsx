import React, { useState } from "react";
import { LiveContextPanel } from "../components/awareness/LiveContextPanel";
import { SuggestionPanel } from "../components/awareness/SuggestionPanel";
import { ActivityTimeline } from "../components/awareness/ActivityTimeline";
import { DailyReportPanel } from "../components/awareness/DailyReportPanel";
import { TrendsPanel } from "../components/awareness/TrendsPanel";

type Tab = "live" | "timeline" | "reports" | "trends";

export default function AwarenessPage() {
  const [tab, setTab] = useState<Tab>("live");

  return (
    <div style={{ padding: "24px", overflow: "auto", height: "100%" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 600, color: "var(--j-text)", margin: 0 }}>
          Awareness
        </h1>
        <div style={{ fontSize: "13px", color: "var(--j-text-muted)", marginTop: "4px" }}>
          Screen context, activity tracking, and proactive suggestions
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "20px" }}>
        <TabBtn label="Live" tab="live" active={tab} onClick={setTab} />
        <TabBtn label="Timeline" tab="timeline" active={tab} onClick={setTab} />
        <TabBtn label="Reports" tab="reports" active={tab} onClick={setTab} />
        <TabBtn label="Trends" tab="trends" active={tab} onClick={setTab} />
      </div>

      {/* Tab content */}
      {tab === "live" && (
        <div style={{ display: "flex", gap: "20px" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px" }}>
            <LiveContextPanel />
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "16px" }}>
            <SuggestionPanel />
          </div>
        </div>
      )}

      {tab === "timeline" && <ActivityTimeline />}

      {tab === "reports" && <DailyReportPanel />}

      {tab === "trends" && <TrendsPanel />}
    </div>
  );
}

function TabBtn({ label, tab, active, onClick }: {
  label: string;
  tab: Tab;
  active: Tab;
  onClick: (t: Tab) => void;
}) {
  const isActive = tab === active;
  return (
    <button
      onClick={() => onClick(tab)}
      style={{
        padding: "8px 16px",
        borderRadius: "6px",
        border: "1px solid " + (isActive ? "var(--j-accent)" : "var(--j-border)"),
        background: isActive ? "rgba(0, 212, 255, 0.1)" : "transparent",
        color: isActive ? "var(--j-accent)" : "var(--j-text-dim)",
        fontSize: "13px",
        fontWeight: isActive ? 600 : 400,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
