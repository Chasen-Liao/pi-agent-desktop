"use client";

import React, { useEffect, useRef, useState } from "react";
import type { AgentMode } from "@/lib/approval-policy";

const MODES: { id: AgentMode; label: string; desc: string }[] = [
  { id: "plan", label: "Plan", desc: "只读探索，先出计划" },
  { id: "ask", label: "Ask", desc: "写/跑前确认" },
  { id: "full", label: "Full", desc: "不逐条确认" },
];

interface Props {
  mode: AgentMode;
  disabled?: boolean;
  onChange: (mode: AgentMode) => void;
}

export function AgentModeSelector({ mode, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = MODES.find((m) => m.id === mode) ?? MODES[1];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={`Agent mode: ${current.label}`}
        aria-label={`Change agent mode. Current mode: ${current.label}`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          padding: 0,
          height: "var(--control-height)",
          background: open ? "var(--bg-hover)" : "none",
          border: "none",
          borderRadius: "var(--radius-control)",
          color: "var(--text-muted)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
        className={disabled ? "" : "hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3 19 6v5c0 4.6-2.9 8-7 10-4.1-2-7-5.4-7-10V6l7-3Z" />
          <path d="m9.5 12 1.7 1.7 3.5-3.7" />
        </svg>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            zIndex: 100,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-panel)",
            boxShadow: "var(--shadow-popover)",
            overflow: "hidden",
            minWidth: 180,
          }}
        >
          {MODES.map((m) => {
            const isActive = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (!isActive) onChange(m.id);
                }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 2,
                  width: "100%",
                  padding: "8px 12px",
                  background: isActive ? "var(--bg-selected)" : "none",
                  border: "none",
                  color: isActive ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 12,
                  textAlign: "left",
                }}
                className={isActive ? "" : "hover:bg-[var(--bg-hover)]"}
              >
                <span style={{ fontWeight: isActive ? 600 : 400 }}>{m.label}</span>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{m.desc}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
