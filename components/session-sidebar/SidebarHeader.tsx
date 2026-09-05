"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { resolveCustomPathSelection } from "@/lib/custom-path-selection";
import type { SessionInfo } from "@/lib/types";
import { PiAgentTitle } from "./PiAgentTitle";
import { getRecentCwds, shortenCwd, pickDirectoryFromHost } from "./helpers";
import { useI18n } from "../I18nProvider";
import { useDismissOnOutsideClick } from "@/hooks/useDismissOnOutsideClick";

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
  const { t } = useI18n();
  const [homeDir, setHomeDir] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [cwdPickerError, setCwdPickerError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/home")
      .then((r) => r.json())
      .then((d: { home?: string }) => {
        if (d.home) setHomeDir(d.home);
      })
      .catch((err) => {
        console.error("Failed to load home dir:", err);
      });
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
      const data = (await res.json()) as { cwd?: string; error?: string };
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

  useDismissOnOutsideClick(
    dropdownRef,
    dropdownOpen || customPathOpen,
    () => {
      setDropdownOpen(false);
      setCustomPathOpen(false);
    },
  );

  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    const tempId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    onNewSession?.(tempId, selectedCwd);
  }, [selectedCwd, onNewSession]);

  const recentCwds = getRecentCwds(allSessions);

  return (
    <div className="p-2.5 pb-[10px] border-b border-divider shrink-0">
      <div className="sidebar-title-row flex items-center justify-between mb-2.5">
        <PiAgentTitle />
        <div className="ml-auto flex gap-1">
          <button
            onClick={handleNewSession}
            disabled={!selectedCwd}
            aria-label={t("sidebar.newSession")}
            className={`sidebar-new-session-button flex h-7 shrink-0 items-center justify-center gap-1 rounded-control border px-2 text-[11px] font-medium tracking-normal transition-[background-color,border-color,color,opacity,transform] duration-150 ${
              selectedCwd
                ? "bg-chrome-button-bg border-border text-text-muted cursor-pointer hover:bg-chrome-button-hover hover:text-accent hover:border-focus-ring"
                : "bg-chrome-button-bg border-border text-text-dim cursor-not-allowed"
            }`}
            title={selectedCwd ? t("sidebar.newSessionIn", { path: selectedCwd }) : t("sidebar.selectProjectFirst")}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="6" y1="1" x2="6" y2="11" />
              <line x1="1" y1="6" x2="11" y2="6" />
            </svg>
            {t("common.new")}
          </button>
          <button
            onClick={() => loadSessions(false)}
            aria-label={t("sidebar.refreshSessions")}
            className={`sidebar-refresh-button flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-control border p-0 transition-[background-color,border-color,color,transform] duration-250 ${
              sessionRefreshDone
                ? "bg-success-bg border-success-border text-success"
                : "bg-chrome-button-bg border-border text-text-muted hover:bg-chrome-button-hover hover:text-accent hover:border-focus-ring"
            }`}
            title={t("common.refresh")}
          >
            {sessionRefreshDone ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* CWD picker */}
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          className={`w-full flex items-center px-2.5 py-1.5 rounded-control cursor-pointer text-[12px] text-text text-left transition-[background-color,border-color,color] duration-150 border ${
            selectedCwd ? "bg-bg-hover border-border" : "bg-warning-bg border-warning-border"
          }`}
        >
          <span
            className={`flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] ${
              selectedCwd ? "text-text" : "text-text-dim"
            }`}
            title={selectedCwd ?? ""}
          >
            {selectedCwd
              ? shortenCwd(selectedCwd, homeDir)
              : initialSessionId && !restoredRef.current
              ? ""
              : t("sidebar.selectProject")}
          </span>
        </button>

        {dropdownOpen && (
          <div className="t-dropdown is-open material-popover absolute top-[calc(100%+4px)] left-0 right-0 z-[100] border border-border rounded-panel shadow-popover overflow-hidden" data-origin="top-left">
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
                className={`flex items-center gap-[7px] w-full px-2.5 py-2 border-none border-b border-divider text-left text-[11px] font-mono overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer ${
                  cwd === selectedCwd ? "bg-bg-selected text-text" : "bg-transparent text-text-muted hover:bg-bg-hover"
                }`}
                title={cwd}
              >
                {cwd === selectedCwd && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <polyline points="1.5 5 4 7.5 8.5 2.5" />
                  </svg>
                )}
                {cwd !== selectedCwd && <span className="w-2.5 shrink-0" />}
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{shortenCwd(cwd, homeDir)}</span>
              </button>
            ))}

            {/* Default cwd shortcut */}
            {!customPathOpen && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDefaultCwd();
                }}
                className="flex items-center gap-[7px] w-full px-2.5 py-2 bg-transparent border-none border-t border-divider text-text-muted hover:bg-bg-hover cursor-pointer text-left text-[11px]"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
                </svg>
                <span>{t("sidebar.defaultDirectory")}</span>
              </button>
            )}

            {/* Custom path entry */}
            {!customPathOpen ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleCustomPath();
                }}
                className="flex items-center gap-[7px] w-full px-2.5 py-2 bg-transparent border-none text-text-muted hover:bg-bg-hover cursor-pointer text-left text-[11px]"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" className="shrink-0">
                  <line x1="5" y1="1" x2="5" y2="9" />
                  <line x1="1" y1="5" x2="9" y2="5" />
                </svg>
                <span>{t("sidebar.customPath")}</span>
              </button>
            ) : (
              <div className="px-2.5 py-2 text-text-muted text-[11px] border-t border-divider">
                {t("sidebar.openingFolderPicker")}
              </div>
            )}
          </div>
        )}
      </div>
      {cwdPickerError && (
        <div className="mt-1.5 color-danger text-[11px]">
          {cwdPickerError}
        </div>
      )}
    </div>
  );
}
