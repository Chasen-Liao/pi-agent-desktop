"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { resolveCustomPathSelection } from "@/lib/custom-path-selection";
import type { SessionInfo } from "@/lib/types";
import { PiAgentTitle } from "./PiAgentTitle";
import { getRecentCwds, shortenCwd, pickDirectoryFromHost } from "./helpers";

interface SidebarHeaderProps {
  selectedCwd: string | null;
  onCwdChange?: (cwd: string | null) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  allSessions: SessionInfo[];
  loadSessions: (showLoading?: boolean) => Promise<void>;
  sessionRefreshDone: boolean;
  initialSessionId?: string | null;
  restoredRef: React.MutableRefObject<boolean>;
}

export function SidebarHeader({
  selectedCwd,
  onCwdChange,
  onNewSession,
  allSessions,
  loadSessions,
  sessionRefreshDone,
  initialSessionId,
  restoredRef,
}: SidebarHeaderProps) {
  const [homeDir, setHomeDir] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [cwdPickerError, setCwdPickerError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch((err) => { console.error("Failed to load home dir:", err); });
  }, []);

  const handleCustomPath = useCallback(async () => {
    setCustomPathOpen(true);
    setCwdPickerError(null);
    try {
      const selectedPath = await pickDirectoryFromHost();
      const { nextCwd, shouldClose } = resolveCustomPathSelection(selectedCwd, selectedPath);
      if (nextCwd !== selectedCwd) {
        onCwdChange?.(nextCwd);
      }
      if (shouldClose) {
        setCustomPathOpen(false);
        setDropdownOpen(false);
      }
    } catch (e) {
      setCwdPickerError(e instanceof Error ? e.message : String(e));
      setCustomPathOpen(false);
      setDropdownOpen(false);
    }
  }, [selectedCwd, onCwdChange]);

  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      if (data.cwd) {
        setCwdPickerError(null);
        if (data.cwd !== selectedCwd) {
          onCwdChange?.(data.cwd);
        }
        setDropdownOpen(false);
      }
    } catch {
      // ignore
    }
  }, [selectedCwd, onCwdChange]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setCustomPathOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    onNewSession?.(tempId, selectedCwd);
  }, [selectedCwd, onNewSession]);

  const recentCwds = getRecentCwds(allSessions);

  return (
    <div
      style={{
        padding: "12px 10px 10px",
        borderBottom: "1px solid var(--divider)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <PiAgentTitle />
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={handleNewSession}
            disabled={!selectedCwd}
            aria-label="New session"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              background: "var(--chrome-button-bg)",
              border: "1px solid var(--border)",
              color: selectedCwd ? "var(--text-muted)" : "var(--text-dim)",
              cursor: selectedCwd ? "pointer" : "not-allowed",
              height: "var(--control-height)",
              paddingLeft: 10,
              paddingRight: 12,
              borderRadius: "var(--radius-control)",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: 0,
              flexShrink: 0,
              transition: "background 0.12s, color 0.12s, border-color 0.12s",
            }}
            title={selectedCwd ? `New session in ${selectedCwd}` : "Select a project first"}
            onMouseEnter={(e) => {
              if (!selectedCwd) return;
              e.currentTarget.style.background = "var(--chrome-button-hover)";
              e.currentTarget.style.color = "var(--accent)";
              e.currentTarget.style.borderColor = "var(--focus-ring)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--chrome-button-bg)";
              e.currentTarget.style.color = selectedCwd ? "var(--text-muted)" : "var(--text-dim)";
              e.currentTarget.style.borderColor = "var(--border)";
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="6" y1="1" x2="6" y2="11" />
              <line x1="1" y1="6" x2="11" y2="6" />
            </svg>
            New
          </button>
          <button
            onClick={() => loadSessions(false)}
            aria-label="Refresh sessions"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              background: sessionRefreshDone ? "var(--success-bg)" : "var(--chrome-button-bg)",
              border: `1px solid ${sessionRefreshDone ? "var(--success-border)" : "var(--border)"}`,
              color: sessionRefreshDone ? "var(--success)" : "var(--text-muted)",
              cursor: "pointer",
              width: 32, height: "var(--control-height)",
              borderRadius: "var(--radius-control)",
              padding: 0,
              flexShrink: 0,
              transition: "background 0.3s, color 0.3s, border-color 0.3s",
            }}
            onMouseEnter={(e) => {
              if (sessionRefreshDone) return;
              e.currentTarget.style.background = "var(--chrome-button-hover)";
              e.currentTarget.style.color = "var(--accent)";
              e.currentTarget.style.borderColor = "var(--focus-ring)";
            }}
            onMouseLeave={(e) => {
              if (sessionRefreshDone) return;
              e.currentTarget.style.background = "var(--chrome-button-bg)";
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.borderColor = "var(--border)";
            }}
            title="Refresh"
          >
            {sessionRefreshDone ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* CWD picker */}
      <div ref={dropdownRef} style={{ position: "relative" }}>
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            padding: "6px 10px",
            background: selectedCwd ? "var(--bg-hover)" : "var(--warning-bg)",
            border: selectedCwd ? "1px solid var(--border)" : "1px solid var(--warning-border)",
            borderRadius: "var(--radius-control)",
            cursor: "pointer",
            fontSize: 12,
            color: "var(--text)",
            textAlign: "left",
            transition: "border-color 0.15s, background 0.15s",
          }}
        >
          <span
            style={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: selectedCwd ? "var(--text)" : "var(--text-dim)",
            }}
            title={selectedCwd ?? ""}
          >
            {selectedCwd ? shortenCwd(selectedCwd, homeDir) : (initialSessionId && !restoredRef.current ? "" : "Select project…")}
          </span>
        </button>

        {dropdownOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              zIndex: 100,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-panel)",
              boxShadow: "var(--shadow-popover)",
              overflow: "hidden",
            }}
          >
            {recentCwds.map((cwd) => (
              <button
                key={cwd}
                onClick={() => {
                  if (cwd !== selectedCwd) {
                    onCwdChange?.(cwd);
                  }
                  setCwdPickerError(null);
                  setCustomPathOpen(false);
                  setDropdownOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  padding: "8px 10px",
                  background: cwd === selectedCwd ? "var(--bg-selected)" : "none",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  color: cwd === selectedCwd ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={cwd}
              >
                {cwd === selectedCwd && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <polyline points="1.5 5 4 7.5 8.5 2.5" />
                  </svg>
                )}
                {cwd !== selectedCwd && <span style={{ width: 10, flexShrink: 0 }} />}
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortenCwd(cwd, homeDir)}</span>
              </button>
            ))}

            {/* Default cwd shortcut */}
            {!customPathOpen && (
              <button
                onClick={(e) => { e.stopPropagation(); handleDefaultCwd(); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  padding: "8px 10px",
                  background: "none",
                  border: "none",
                  borderTop: recentCwds.length > 0 ? "1px solid var(--border)" : "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 11,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
                </svg>
                <span>Use default directory</span>
              </button>
            )}

            {/* Custom path entry */}
            {!customPathOpen ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleCustomPath();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  padding: "8px 10px",
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 11,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
                  <line x1="5" y1="1" x2="5" y2="9" />
                  <line x1="1" y1="5" x2="9" y2="5" />
                </svg>
                <span>Custom path…</span>
              </button>
            ) : (
              <div
                style={{
                  padding: "8px 10px",
                  color: "var(--text-muted)",
                  fontSize: 11,
                  borderTop: recentCwds.length > 0 ? "none" : undefined,
                }}
              >
                Opening folder picker...
              </div>
            )}
          </div>
        )}
      </div>
      {cwdPickerError && (
        <div style={{ marginTop: 6, color: "var(--danger)", fontSize: 11 }}>
          {cwdPickerError}
        </div>
      )}
    </div>
  );
}
