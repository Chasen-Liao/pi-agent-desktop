"use client";

import React, { useEffect, useState } from "react";
import type { ExtensionUiRequestEvent } from "@/hooks/agent-session/agent-events-manager";

export type ExtensionUiResponsePayload = {
  id: string;
  confirmed?: boolean;
  value?: string;
  cancelled?: boolean;
};

interface Props {
  request: ExtensionUiRequestEvent | null;
  onRespond: (payload: ExtensionUiResponsePayload) => void;
}

export function ExtensionUiDialog({ request, onRespond }: Props) {
  const [text, setText] = useState("");

  useEffect(() => {
    if (!request) {
      setText("");
      return;
    }
    setText(request.prefill ?? "");
  }, [request]);

  if (!request) return null;

  const close = (payload: ExtensionUiResponsePayload) => onRespond(payload);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={request.title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={() => close({ id: request.id, cancelled: true })}
    >
      <div
        style={{
          width: "min(440px, 100%)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 18,
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{request.title}</div>
        {request.method === "confirm" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {request.message}
          </p>
        )}
        {request.method === "select" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(request.options ?? []).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => close({ id: request.id, value: opt })}
                style={{
                  padding: "8px 10px",
                  textAlign: "left",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--bg-panel)",
                  color: "var(--text)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
        {(request.method === "input" || request.method === "editor") && (
          request.method === "editor" ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={request.placeholder ?? ""}
              rows={8}
              style={{
                width: "100%",
                resize: "vertical",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                padding: 10,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
              }}
            />
          ) : (
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={request.placeholder ?? ""}
              style={{
                width: "100%",
                fontSize: 12,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
              }}
            />
          )
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={() => close({ id: request.id, cancelled: true })}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            取消
          </button>
          {request.method === "confirm" && (
            <>
              <button
                type="button"
                onClick={() => close({ id: request.id, confirmed: false })}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-panel)",
                  color: "var(--text)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                拒绝
              </button>
              <button
                type="button"
                onClick={() => close({ id: request.id, confirmed: true })}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--accent)",
                  color: "var(--accent-contrast, #fff)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                允许
              </button>
            </>
          )}
          {(request.method === "input" || request.method === "editor") && (
            <button
              type="button"
              onClick={() => close({ id: request.id, value: text })}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "none",
                background: "var(--accent)",
                color: "var(--accent-contrast, #fff)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              确定
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
