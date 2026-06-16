"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow } from "./ChatWindow";
import { FileViewer } from "./FileViewer";
import { TabBar } from "./TabBar";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { BranchNavigator } from "./BranchNavigator";
import { useTheme } from "@/hooks/useTheme";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ChatInputHandle } from "./ChatInput";
import { usePanelLayout } from "@/hooks/usePanelLayout";
import { useFileTabs } from "@/hooks/useFileTabs";
import { StatsBar } from "./StatsBar";

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDark, toggleTheme } = useTheme();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [skillsConfigOpen, setSkillsConfigOpen] = useState(false);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);

  const {
    sidebarOpen,
    setSidebarOpen,
    rightPanelOpen,
    setRightPanelOpen,
    panelWidths,
    beginPanelResize,
  } = usePanelLayout();

  const {
    fileTabs,
    activeFileTabId,
    setActiveFileTabId,
    handleOpenFile,
    handleCloseFileTab,
  } = useFileTabs(
    () => setRightPanelOpen(true),
    () => setRightPanelOpen(false)
  );

  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

  const handleBranchDataChange = useCallback(
    (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
      setBranchTree(tree);
      setBranchActiveLeafId(activeLeafId);
      branchLeafChangeFnRef.current = onLeafChange;
    },
    []
  );

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const systemBtnRef = useRef<HTMLButtonElement>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

  const handleSessionStatsChange = useCallback(
    (stats: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost?: number } | null) => {
      window.dispatchEvent(new CustomEvent("pi-session-stats", { detail: stats }));
    },
    []
  );

  const handleContextUsageChange = useCallback(
    (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => {
      window.dispatchEvent(new CustomEvent("pi-context-usage", { detail: usage }));
    },
    []
  );

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"branches" | "system" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const toggleTopPanel = useCallback((panel: "branches" | "system") => {
    setActiveTopPanel((cur) => (cur === panel ? null : panel));
  }, []);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const rect = topBarRef.current!.getBoundingClientRect();
      setTopPanelPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel]);

  const [initialSessionId, setInitialSessionId] = useState<string | null>(null);
  const [initialSessionRestored, setInitialSessionRestored] = useState(false);
  const [activeCwd, setActiveCwd] = useState<string | null>(null);

  useEffect(() => {
    const s = searchParams.get("session");
    if (s) {
      setInitialSessionId(s);
    } else {
      setInitialSessionRestored(true);
    }
  }, [searchParams]);

  const handleCwdChange = useCallback((cwd: string | null) => {
    setActiveCwd(cwd);
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleSelectSession = useCallback(
    (session: SessionInfo, isRestore?: boolean) => {
      setSelectedSession(session);
      setNewSessionCwd(null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setActiveTopPanel(null);

      if (session.cwd && session.cwd !== activeCwd) {
        setActiveCwd(session.cwd);
        setExplorerRefreshKey((k) => k + 1);
      }

      if (!isRestore) {
        router.replace(`/?session=${encodeURIComponent(session.id)}`, { scroll: false });
      }
      setInitialSessionRestored(true);
    },
    [router, activeCwd]
  );

  const handleNewSession = useCallback(
    (tempId: string, cwd: string) => {
      setSelectedSession(null);
      setNewSessionCwd(cwd);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setActiveTopPanel(null);

      if (cwd !== activeCwd) {
        setActiveCwd(cwd);
        setExplorerRefreshKey((k) => k + 1);
      }

      router.replace("/", { scroll: false });
    },
    [router, activeCwd]
  );

  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setRefreshKey((k) => k + 1);
    router.replace(`/?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [router]);


  const handleSessionForked = useCallback(
    (newId: string) => {
      setRefreshKey((k) => k + 1);
      // Wait for registry refresh, then load
      setTimeout(async () => {
        try {
          const res = await fetch("/api/sessions");
          if (!res.ok) return;
          const data = (await res.json()) as { sessions: SessionInfo[] };
          const s = data.sessions.find((x) => x.id === newId);
          if (s) {
            handleSelectSession(s, false);
          }
        } catch {
          // ignore
        }
      }, 50);
    },
    [handleSelectSession]
  );

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleAtMention = useCallback((relativePath: string) => {
    chatInputRef.current?.insertText(`@${relativePath}`);
  }, []);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback(
    (sessionId: string) => {
      setRefreshKey((k) => k + 1);
      if (selectedSession?.id === sessionId) {
        const cwd = selectedSession.cwd;
        setSelectedSession(null);
        setNewSessionCwd(cwd ?? null);
        setSessionKey((k) => k + 1);
        setBranchTree([]);
        setBranchActiveLeafId(null);
        setSystemPrompt(null);
        setActiveTopPanel(null);
        router.replace("/", { scroll: false });
      }
    },
    [selectedSession, router]
  );


  // Keyboard shortcuts: Windows-oriented app commands.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();

      if (e.altKey && !e.shiftKey && key === "b") {
        e.preventDefault();
        setRightPanelOpen((v) => !v);
        return;
      }
      if (e.altKey) return;

      if (!e.shiftKey && key === "b") {
        e.preventDefault();
        setSidebarOpen((v) => !v);
        return;
      }
      if (e.shiftKey && key === "b") {
        e.preventDefault();
        setRightPanelOpen((v) => !v);
        return;
      }
      if (e.shiftKey && key === "m") {
        e.preventDefault();
        setModelsConfigOpen(true);
        return;
      }
      if (e.shiftKey && key === "s") {
        const cwd = activeCwd ?? selectedSession?.cwd ?? newSessionCwd;
        if (!cwd) return;
        e.preventDefault();
        setSkillsConfigOpen(true);
        return;
      }
      if (e.shiftKey && key === "t") {
        e.preventDefault();
        toggleTheme();
        return;
      }
      if (e.shiftKey && key === "f") {
        e.preventDefault();
        setRightPanelOpen(true);
        return;
      }
      if (!e.shiftKey && key === "n") {
        const cwd = activeCwd ?? selectedSession?.cwd ?? newSessionCwd;
        if (!cwd) return;
        e.preventDefault();
        handleNewSession("", cwd);
      }
    };
    
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [activeCwd, handleNewSession, newSessionCwd, selectedSession?.cwd, toggleTheme, setRightPanelOpen, setSidebarOpen]);

  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  const showPlaceholder = initialSessionRestored && !showChat;
  const activeFileTab = fileTabs.find((t) => t.id === activeFileTabId) ?? null;

  const sidebarContent = (
    <>
      <SessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        initialSessionId={initialSessionId}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        selectedCwd={activeCwd ?? selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onOpenFile={handleOpenFile}
        explorerRefreshKey={explorerRefreshKey}
        onAtMention={handleAtMention}
      />
      <div className="p-2 shrink-0 flex justify-between gap-1">
        {(
          [
            {
              label: "Models",
              onClick: () => setModelsConfigOpen(true),
              disabled: false,
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <rect x="9" y="9" width="6" height="6" />
                  <line x1="9" y1="1" x2="9" y2="4" />
                  <line x1="15" y1="1" x2="15" y2="4" />
                  <line x1="9" y1="20" x2="9" y2="23" />
                  <line x1="15" y1="20" x2="15" y2="23" />
                  <line x1="20" y1="9" x2="23" y2="9" />
                  <line x1="20" y1="14" x2="23" y2="14" />
                  <line x1="1" y1="9" x2="4" y2="9" />
                  <line x1="1" y1="14" x2="4" y2="14" />
                </svg>
              ),
            },
            {
              label: "Skills",
              onClick: () => setSkillsConfigOpen(true),
              disabled: !activeCwd && !selectedSession?.cwd && !newSessionCwd,
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              ),
            },
          ] as { label: string; onClick: () => void; disabled: boolean; icon: React.ReactNode }[]
        ).map(({ label, onClick, disabled, icon }) => (
          <button
            key={label}
            onClick={onClick}
            disabled={disabled}
            title={label}
            aria-label={label}
            className={`flex-1 flex items-center justify-center gap-1.5 h-control-height p-0 bg-transparent border-none rounded-control text-[12px] transition-colors duration-120 ${
              disabled
                ? "cursor-default opacity-35 text-text-muted"
                : "cursor-pointer text-text-muted hover:bg-bg-hover hover:text-text"
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <>
      <div className="flex h-screen overflow-hidden bg-bg">
        {/* Mobile overlay backdrop */}
        <div
          className="sidebar-overlay-backdrop fixed inset-0 z-[199] bg-black/40 transition-opacity duration-250 ease-in-out"
          onClick={() => setSidebarOpen(false)}
          style={{
            opacity: sidebarOpen ? 1 : 0,
            pointerEvents: sidebarOpen ? "auto" : "none",
          }}
        />

        {/* Left sidebar */}
        <div
          className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"} bg-bg-panel border-r border-divider flex flex-col shrink-0 z-[200]`}
          style={{
            width: sidebarOpen ? panelWidths.left : 0,
            minWidth: sidebarOpen ? panelWidths.left : 0,
          }}
        >
          {sidebarContent}
          {sidebarOpen && (
            <div
              className="panel-resize-handle panel-resize-handle-left"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              onPointerDown={(e) => beginPanelResize("left", e)}
            />
          )}
        </div>

        {/* Center: chat */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Top bar with sidebar toggle */}
          <div ref={topBarRef} className="flex items-center shrink-0 border-b border-divider h-toolbar-height bg-bg-elevated [-webkit-app-region:drag]">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              className="flex items-center justify-center w-9 h-full p-0 bg-transparent border-none border-r border-divider text-text-muted hover:text-text cursor-pointer shrink-0 transition-colors duration-120 [-webkit-app-region:no-drag]"
            >
              {sidebarOpen ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              )}
            </button>
            <button
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
              }}
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              aria-pressed={isDark}
              className="flex items-center justify-center w-9 h-full p-0 bg-transparent border-none border-r border-divider text-text-muted hover:text-text cursor-pointer shrink-0 transition-colors duration-120 [-webkit-app-region:no-drag]"
            >
              {isDark ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            {showChat && (
              <div className="flex items-stretch h-full [-webkit-app-region:no-drag]">
                <BranchNavigator
                  tree={branchTree}
                  activeLeafId={branchActiveLeafId}
                  onLeafChange={handleBranchLeafChange}
                  inline
                  containerRef={topBarRef}
                  open={activeTopPanel === "branches"}
                  onToggle={() => toggleTopPanel("branches")}
                  hasSession
                />
                <button
                  ref={systemBtnRef}
                  onClick={() => toggleTopPanel("system")}
                  className={`flex items-center gap-1.5 h-full px-3 border-none border-r border-divider cursor-pointer text-[11px] whitespace-nowrap transition-all duration-100 ${
                    activeTopPanel === "system"
                      ? "bg-bg-selected border-t-2 border-t-accent text-text"
                      : "bg-transparent border-t-2 border-t-transparent text-text-muted hover:text-text"
                  }`}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`shrink-0 ${systemPrompt ? "text-accent" : "text-text-dim"}`}
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="8" y1="13" x2="16" y2="13" />
                    <line x1="8" y1="17" x2="13" y2="17" />
                  </svg>
                  <span>System</span>
                </button>
              </div>
            )}
            <div className="flex-1" />
            <StatsBar showChat={showChat} />
            {!rightPanelOpen && (
              <>
                <button
                  onClick={() => setRightPanelOpen(true)}
                  title="Show file panel"
                  aria-label="Show file panel"
                  className="flex items-center justify-center w-9 h-full p-0 bg-transparent border-none border-l border-divider text-text-muted hover:text-text cursor-pointer shrink-0 transition-colors duration-120 [-webkit-app-region:no-drag]"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="15" y1="3" x2="15" y2="21" />
                  </svg>
                </button>
                <div className="w-titlebar shrink-0" />
              </>
            )}
            {/* Top panel dropdown — shared, only one active at a time */}
            {activeTopPanel && topPanelPos && (
              <div
                className="fixed z-[500]"
                style={{
                  top: topPanelPos.top,
                  left: topPanelPos.left,
                  width: topPanelPos.width,
                }}
              >
                {activeTopPanel === "system" && (
                  <div className="bg-bg-elevated border-b border-divider shadow-popover">
                    {systemPrompt ? (
                      <div className="max-h-[min(600px,75vh)] overflow-y-auto px-4 py-3 text-text-muted text-[12px] leading-[1.6] whitespace-pre-wrap font-mono">
                        {systemPrompt}
                      </div>
                    ) : systemPrompt === "" ? (
                      <div className="px-4 py-2.5 text-[12px] text-text-muted italic">
                        System prompt is empty (tools are disabled)
                      </div>
                    ) : (
                      <div className="px-4 py-2.5 text-[12px] text-text-muted italic">
                        Send a message to load the system prompt
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Chat content */}
          <div className="flex-1 overflow-hidden relative">
            {showChat ? (
              <ChatWindow
                key={sessionKey}
                session={selectedSession}
                newSessionCwd={effectiveNewSessionCwd}
                onAgentEnd={handleAgentEnd}
                onSessionCreated={handleSessionCreated}
                onSessionForked={handleSessionForked}
                modelsRefreshKey={modelsRefreshKey}
                chatInputRef={chatInputRef}
                onBranchDataChange={handleBranchDataChange}
                onSystemPromptChange={handleSystemPromptChange}
                onSessionStatsChange={handleSessionStatsChange}
                onContextUsageChange={handleContextUsageChange}
              />
            ) : showPlaceholder ? (
              activeCwd ? (
                <div className="h-full flex items-center justify-center text-text-muted text-[15px]">
                  Select a session from the sidebar
                </div>
              ) : (
                <div className="absolute top-3 left-3 flex items-start gap-2 select-none pointer-events-none">
                  <svg
                    width="44"
                    height="44"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="opacity-70 shrink-0"
                  >
                    <line x1="20" y1="12" x2="4" y2="12" />
                    <polyline points="10 6 4 12 10 18" />
                  </svg>
                  <div>
                    <div className="text-[18px] font-semibold text-text mb-2">Get Started</div>
                    <div className="text-[12px] text-text-muted leading-[1.8]">
                      <span className="text-text-dim mr-1.5">1.</span>Select a project directory from the sidebar
                      <br />
                      <span className="text-text-dim mr-1.5">2.</span>Add models via the{" "}
                      <strong className="text-text">Models</strong> button at the bottom
                    </div>
                  </div>
                </div>
              )
            ) : null}
          </div>
        </div>

        {/* Right panel: file viewer — always mounted, width animated via CSS */}
        <div
          className={`right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"} flex flex-col border-l border-divider bg-bg relative`}
          style={{
            width: rightPanelOpen ? panelWidths.right : 0,
            minWidth: rightPanelOpen ? panelWidths.right : 0,
          }}
        >
          {rightPanelOpen && (
            <div
              className="panel-resize-handle panel-resize-handle-right"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize file panel"
              onPointerDown={(e) => beginPanelResize("right", e)}
            />
          )}
          {/* Right panel tab bar */}
          <div className="flex items-center shrink-0 bg-bg-elevated border-b border-divider h-toolbar-height [-webkit-app-region:drag]">
            <div className="flex-1 overflow-hidden [-webkit-app-region:no-drag]">
              <TabBar
                tabs={fileTabs}
                activeTabId={activeFileTabId ?? ""}
                onSelectTab={setActiveFileTabId}
                onCloseTab={handleCloseFileTab}
              />
            </div>
            <button
              onClick={() => setRightPanelOpen(false)}
              title="Hide file panel"
              aria-label="Hide file panel"
              className="flex items-center justify-center w-9 h-full p-0 bg-transparent border-none border-l border-divider text-text hover:text-text cursor-pointer shrink-0 transition-colors duration-120 [-webkit-app-region:no-drag]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="15" y1="3" x2="15" y2="21" />
              </svg>
            </button>
            <div className="w-titlebar shrink-0" />
          </div>

          {/* File content */}
          <div className="flex-1 overflow-hidden">
            {activeFileTab?.filePath ? (
              <FileViewer filePath={activeFileTab.filePath} cwd={activeCwd ?? undefined} />
            ) : (
              <div className="h-full flex items-center justify-center text-text-dim text-[12px]">No file open</div>
            )}
          </div>
        </div>
      </div>

      {modelsConfigOpen && (
        <ModelsConfig
          onClose={() => {
            setModelsConfigOpen(false);
            setModelsRefreshKey((k) => k + 1);
          }}
        />
      )}
      {skillsConfigOpen && (activeCwd ?? selectedSession?.cwd ?? newSessionCwd) && (
        <SkillsConfig
          cwd={(activeCwd ?? selectedSession?.cwd ?? newSessionCwd)!}
          onClose={() => setSkillsConfigOpen(false)}
        />
      )}
    </>
  );
}
