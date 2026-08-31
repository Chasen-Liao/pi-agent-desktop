"use client";

import React from "react";
import type { NeedsTrustPayload } from "@/lib/trust-types";
import { useI18n } from "./I18nProvider";

export type { NeedsTrustPayload };

interface Props {
  payload: NeedsTrustPayload | null;
  onChoose: (optionId: string) => void;
  onCancel?: () => void;
}

export function ProjectTrustDialog({ payload, onChoose, onCancel }: Props) {
  const { t } = useI18n();
  if (!payload) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("trust.title")}
      className="ui-dialog-backdrop"
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
        className="t-modal is-open ui-dialog-surface"
        style={{
          width: "min(460px, 100%)",
          background: "var(--material-popover)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 18,
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{t("trust.question")}</div>
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {t("trust.description")}
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
              {opt.id === "trust"
                ? t("trust.option.trust")
                : opt.id === "trust-parent"
                  ? t("trust.option.parent", { path: opt.parentPath ?? "" })
                  : opt.id === "trust-session"
                    ? t("trust.option.session")
                    : opt.id === "deny"
                      ? t("trust.option.deny")
                      : t("trust.option.denySession")}
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
            {t("common.cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
