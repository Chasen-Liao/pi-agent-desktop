"use client";

import React from "react";
import type { NeedsTrustPayload, TrustOptionDto } from "@/lib/trust-types";

export type { NeedsTrustPayload };

interface Props {
  payload: NeedsTrustPayload | null;
  onChoose: (optionId: string) => void;
  onCancel?: () => void;
}

export function ProjectTrustDialog({ payload, onChoose, onCancel }: Props) {
  if (!payload) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Project trust"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1001,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(460px, 100%)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 18,
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>信任此项目？</div>
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          项目目录含有 .pi 配置或 skills。信任后会加载项目级设置、扩展与技能。
        </p>
        <code
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            wordBreak: "break-all",
            fontFamily: "var(--font-mono)",
          }}
        >
          {payload.cwd}
        </code>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {payload.options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChoose(opt.id)}
              style={{
                padding: "8px 10px",
                textAlign: "left",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: opt.trusted ? "var(--bg-panel)" : "transparent",
                color: "var(--text)",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              alignSelf: "flex-end",
              padding: "6px 12px",
              border: "none",
              background: "transparent",
              color: "var(--text-dim)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            取消
          </button>
        )}
      </div>
    </div>
  );
}
