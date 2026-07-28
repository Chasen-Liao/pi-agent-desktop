"use client";

import React from "react";

interface Props {
  visible: boolean;
  disabled?: boolean;
  onExecute: () => void;
}

export function ExecutePlanBar({ visible, disabled, onExecute }: Props) {
  if (!visible) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 12px",
        margin: "0 12px 8px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--bg-panel)",
      }}
    >
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
        计划已就绪。执行将切换到 Ask 模式（写/跑前会确认）。
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onExecute}
        style={{
          padding: "6px 14px",
          borderRadius: 8,
          border: "none",
          background: disabled ? "var(--border)" : "var(--accent)",
          color: "var(--accent-contrast, #fff)",
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        执行此计划
      </button>
    </div>
  );
}
