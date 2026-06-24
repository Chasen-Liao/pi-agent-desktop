"use client";

import React, { useState, useEffect, useRef } from "react";

const TOOL_PRESETS = ["off", "default", "full"] as const;
const TOOL_PRESET_MAP: Record<"off" | "default" | "full", "none" | "default" | "full"> = {
  off: "none",
  default: "default",
  full: "full",
};

interface PresetSelectorProps {
  isStreaming: boolean;
  toolPreset?: "none" | "default" | "full";
  onToolPresetChange?: (preset: "none" | "default" | "full") => void;
}

export function PresetSelector({
  isStreaming,
  toolPreset,
  onToolPresetChange,
}: PresetSelectorProps) {
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const toolDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolDropdownRef.current && !toolDropdownRef.current.contains(e.target as Node)) {
        setToolDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!onToolPresetChange) {
    return null;
  }

  return (
    <div ref={toolDropdownRef} style={{ position: "relative" }}>
      <button
        onClick={() => !isStreaming && setToolDropdownOpen((v) => !v)}
        disabled={isStreaming}
        title="切换工具预设"
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "8px 12px",
          height: "var(--control-height)",
          background: toolDropdownOpen ? "var(--bg-hover)" : "none",
          border: "none",
          borderRadius: "var(--radius-control)",
          color: "var(--text-muted)",
          cursor: isStreaming ? "not-allowed" : "pointer",
          fontSize: 12,
          opacity: isStreaming ? 0.5 : 1,
        }}
        className={isStreaming ? "" : "hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:scale-95 transition-all duration-150"}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
        <span>{Object.entries(TOOL_PRESET_MAP).find(([, v]) => v === (toolPreset ?? "default"))?.[0] ?? "default"}</span>
      </button>
      {toolDropdownOpen && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", right: 0,
          zIndex: 100, background: "var(--bg)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-panel)", boxShadow: "var(--shadow-popover)",
          overflow: "hidden", minWidth: 120,
        }}>
          {TOOL_PRESETS.map((lvl) => {
            const preset = TOOL_PRESET_MAP[lvl];
            const isActive = (toolPreset ?? "default") === preset;
            const desc = lvl === "off" ? "无工具，纯聊天" : lvl === "default" ? "4 项内置工具" : "全部内置工具";
            return (
              <button
                key={lvl}
                onClick={() => { setToolDropdownOpen(false); if (!isActive) onToolPresetChange(preset); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", padding: "7px 12px",
                  background: isActive ? "var(--bg-selected)" : "none",
                  border: "none",
                  color: isActive ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer", fontSize: 12, textAlign: "left",
                  fontWeight: isActive ? 600 : 400,
                  whiteSpace: "nowrap",
                }}
                className={isActive ? "" : "hover:bg-[var(--bg-hover)] transition-colors duration-150"}
              >
                {isActive
                  ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                  : <span style={{ width: 10, flexShrink: 0 }} />}
                <span style={{ flex: 1 }}>{lvl}</span>
                <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
