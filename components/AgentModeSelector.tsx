"use client";

import React, { useRef, useState } from "react";
import type { AgentMode } from "@/lib/approval-policy";
import { useI18n } from "./I18nProvider";
import { useDismissOnOutsideClick } from "@/hooks/useDismissOnOutsideClick";

const MODE_IDS: AgentMode[] = ["plan", "ask", "full"];

interface Props {
  mode: AgentMode;
  disabled?: boolean;
  onChange: (mode: AgentMode) => void;
}

export function AgentModeSelector({ mode, disabled, onChange }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useDismissOnOutsideClick(ref, open, () => setOpen(false));

  const modes = MODE_IDS.map((id) => ({
    id,
    label: t(`agentMode.${id}.label`),
    desc: t(`agentMode.${id}.desc`),
  }));
  const current = modes.find((item) => item.id === mode) ?? modes[1];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={t("agentMode.title", { mode: current.label })}
        aria-label={t("agentMode.change", { mode: current.label })}
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
          {modes.map((m) => {
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
