"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionInfo, SessionTreeNode, ToolResultMessage } from "@/lib/types";
import { MessageList } from "./MessageList";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import { useAgentSession } from "@/hooks/useAgentSession";
import type { AgentPhase } from "@/hooks/agent-session/agent-phase";
import { useAudio } from "@/hooks/useAudio";
import { useDragDrop } from "@/hooks/useDragDrop";

interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsChange?: (stats: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost?: number } | null) => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
}

function phaseLabel(phase: AgentPhase): string {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((t) => t.name);
    if (names.length === 0) return "Running tool...";
    if (names.length === 1) return `Running ${names[0]}...`;
    if (names.length <= 3) return `Running ${names.join(", ")}...`;
    return `Running ${names.slice(0, 2).join(", ")} (+${names.length - 2})...`;
  }
  if (phase?.kind === "waiting_model") return "Waiting for model...";
  return "Thinking...";
}

const TYPEWRITER_PHRASES = [
  "ready when you are.",
  "ask me anything.",
  "let's build something cool.",
  "explore your codebase.",
  "draft an email.",
  "summarize that paper.",
  "plan your weekend.",
  "explain it like I'm five.",
  "pair-program with me.",
  "fix that pesky bug.",
  "translate to 中文.",
  "write a haiku.",
  "brainstorm ideas.",
  "review my pull request.",
  "what should we cook tonight?",
  "ship it.",
  "make it pretty.",
  "rubber-duck with me.",
];

function Typewriter({ phrases }: { phrases: string[] }) {
  const [phraseIdx, setPhraseIdx] = useState(() => Math.floor(Math.random() * phrases.length));
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [caretOn, setCaretOn] = useState(true);

  useEffect(() => {
    const blink = setInterval(() => setCaretOn((v) => !v), 530);
    return () => clearInterval(blink);
  }, []);

  useEffect(() => {
    const current = phrases[phraseIdx];
    let timeout: ReturnType<typeof setTimeout>;
    if (!deleting && text === current) {
      timeout = setTimeout(() => setDeleting(true), 1800);
    } else if (deleting && text === "") {
      setDeleting(false);
      setPhraseIdx((i) => (i + 1) % phrases.length);
    } else {
      const next = deleting ? current.slice(0, text.length - 1) : current.slice(0, text.length + 1);
      timeout = setTimeout(() => setText(next), deleting ? 28 : 55);
    }
    return () => clearTimeout(timeout);
  }, [text, deleting, phraseIdx, phrases]);

  return (
    <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
      {text}
      <span style={{ opacity: caretOn ? 1 : 0, color: "var(--accent)", marginLeft: 1 }}>▍</span>
    </span>
  );
}

const ACTION_CARDS = [
  {
    icon: (
      <svg className="w-4 h-4 text-[var(--accent)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.63 8.41m5.96 5.96a14.96 14.96 0 01-10.47 5.26 14.96 14.96 0 01-5.26-10.47m15.73 5.21a5.97 5.97 0 00-1.8-3.77m-1.52-1.52a5.98 5.98 0 00-3.77-1.8M1 21l3.4-3.4m-1.11-1.11L5 15m10.5-9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
      </svg>
    ),
    title: "架构探索",
    desc: "梳理项目整体的目录结构与核心模块入口",
    prompt: "帮我梳理一下当前工程的整体目录结构和主要模块，找出关键的入口文件。"
  },
  {
    icon: (
      <svg className="w-4 h-4 text-[var(--accent)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    title: "代码诊断",
    desc: "检查组件代码，发现潜在缺陷、瓶颈或规范问题",
    prompt: "检查这个工程里关键组件的代码质量，指出任何潜在的 bug、性能瓶颈或不规范的写法。"
  },
  {
    icon: (
      <svg className="w-4 h-4 text-[var(--accent)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
      </svg>
    ),
    title: "功能开发",
    desc: "在现有项目中设计方案并实现具体业务逻辑",
    prompt: "我想在当前项目中添加一个全局通知组件，请帮我设计实现方案并写出具体代码。"
  },
  {
    icon: (
      <svg className="w-4 h-4 text-[var(--accent)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18.5M12 7v5l3 3" />
      </svg>
    ),
    title: "重构优化",
    desc: "分析并拆分臃肿组件，抽离出 hooks 与工具函数",
    prompt: "分析当前项目中最繁琐或臃肿的组件，帮我进行模块拆分并抽离成自定义 hooks 或工具函数。"
  }
];

export function ChatWindow({ session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSessionStatsChange, onContextUsageChange }: Props) {
  const { soundEnabled, onSoundToggle, playDoneSound } = useAudio();
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  // Play a sound on agent_end — wired via useAgentSession's onAgentEndEvent
  // option so it runs inside the real event handler (not a stale ref wrapper
  // that could drift behind the latest business handler on re-render).
  const handleAgentEndEvent = useCallback(() => {
    if (soundEnabledRef.current) playDoneSoundRef.current();
  }, []);

  const {
    loading, error, messages, entryIds, streamState,
    agentRunning, modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, toolPreset, thinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, displayModel: displayModelValue, sessionStats,
    agentPhase,
    isNew,
    messagesEndRef, scrollContainerRef,
    lastUserMsgRef,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handleAbortCompaction,
    handleToolPresetChange, handleThinkingLevelChange, handleAgentEventRef,
    connectEvents,
  } = useAgentSession({
    session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, onBranchDataChange, onSystemPromptChange,
    onAgentEndEvent: handleAgentEndEvent,
  });

  const [connectionStatus, setConnectionStatus] = useState<string>("disconnected");

  useEffect(() => {
    const handleStatusChange = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      setConnectionStatus(customEvent.detail);
    };
    window.addEventListener("pi-connection-status", handleStatusChange);
    return () => {
      window.removeEventListener("pi-connection-status", handleStatusChange);
    };
  }, []);

  const handleReconnect = useCallback(() => {
    if (session) {
      connectEvents(session.id);
    }
  }, [session, connectEvents]);

  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? `${sessionStats.tokens.input}|${sessionStats.tokens.output}|${sessionStats.tokens.cacheRead}|${sessionStats.tokens.cacheWrite}|${sessionStats.cost ?? 0}`
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  const onDrop = useCallback((files: File[]) => {
    chatInputRef?.current?.addImages(files);
  }, [chatInputRef]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const visibleMessages = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const messageRefs = useMessageRefs(visibleMessages.length);

  const toolResultsMap = useMemo(() => {
    const m = new Map<string, ToolResultMessage>();
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        m.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
      }
    }
    return m;
  }, [messages]);

  const { nextUserIdx, nextAssistantIdx } = useMemo(() => {
    const nextUserIdx: number[] = new Array(messages.length).fill(-1);
    const nextAssistantIdx: number[] = new Array(messages.length).fill(-1);
    let lastUser = -1;
    let lastAssistant = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        nextUserIdx[i] = lastUser;
        lastUser = i;
      } else if (messages[i].role === "assistant") {
        nextAssistantIdx[i] = lastAssistant;
        lastAssistant = i;
      }
    }
    return { nextUserIdx, nextAssistantIdx };
  }, [messages]);

  const handleEditContent = useCallback((content: string) => {
    chatInputRef?.current?.insertIfEmpty(content);
  }, [chatInputRef]);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      onSend={handleSend}
      onAbort={handleAbort}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      isStreaming={agentRunning}
      currentCwd={session?.cwd ?? newSessionCwd}
      model={displayModelValue}
      modelNames={modelNames}
      modelList={modelList}
      onModelChange={handleModelChange}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      toolPreset={toolPreset}
      onToolPresetChange={session || isNew ? handleToolPresetChange : undefined}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      retryInfo={retryInfo}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
    />
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        Loading session...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {connectionStatus === "failed" && (
        <div className="bg-danger-bg border-b border-danger-border px-4 py-2.5 flex items-center justify-between text-[12px] text-danger shrink-0 z-50">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>连接已彻底中断，检测到网络异常</span>
          </div>
          <button
            onClick={handleReconnect}
            className="px-2.5 py-1 bg-danger text-accent-contrast rounded-control cursor-pointer hover:bg-danger-hover transition-colors font-medium text-[11px]"
          >
            手动重新连接
          </button>
        </div>
      )}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center bg-[var(--info-bg)] backdrop-blur-[1px]">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid border-[var(--info-border)] animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                style={{ transformOrigin: "center", animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
            className="drop-shadow-[0_6px_18px_var(--focus-ring)]"
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="var(--info-bg)" stroke="var(--info-border)" strokeWidth="1.8"/>
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="var(--info-bg)" stroke="var(--info-border)" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="96" cy="58" r="8" fill="var(--info-bg)" stroke="var(--info-border)" strokeWidth="1.6"/>
            <g stroke="var(--info)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}

      {isEmptyNew ? (
        <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-8 md:py-16">
          <style>{`
            @keyframes ambient-glow-orange {
              0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.1; }
              50% { transform: translate(60px, 40px) scale(1.15); opacity: 0.16; }
            }
            @keyframes ambient-glow-blue {
              0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.06; }
              50% { transform: translate(-40px, -60px) scale(1.1); opacity: 0.12; }
            }
            .ambient-glow-1 {
              animation: ambient-glow-orange 15s ease-in-out infinite alternate;
            }
            .ambient-glow-2 {
              animation: ambient-glow-blue 18s ease-in-out infinite alternate;
            }
          `}</style>

          {/* Background Ambient Glow */}
          <div className="absolute top-[10%] left-[20%] w-[360px] h-[360px] rounded-full bg-[var(--accent)] filter blur-[120px] pointer-events-none ambient-glow-1 select-none z-0" />
          <div className="absolute bottom-[15%] right-[20%] w-[380px] h-[380px] rounded-full bg-[var(--info)] filter blur-[120px] pointer-events-none ambient-glow-2 select-none z-0" />

          <div className="w-full max-w-[820px] z-10 flex flex-col justify-center">
            {/* Header Brand */}
            <div className="flex flex-col items-center text-center mb-10 select-none">
              <div className="relative flex items-center justify-center w-16 h-16 rounded-[22px] bg-gradient-to-tr from-[var(--accent)] to-[#ff4b2b] dark:to-[#ffb454] shadow-[0_8px_30px_rgba(255,143,64,0.25)] dark:shadow-[0_8px_30px_rgba(255,180,84,0.18)] hover:scale-105 hover:-translate-y-0.5 transition-all duration-300 cursor-pointer group mb-4">
                <span className="text-white font-extrabold text-[36px] leading-none mb-1 group-hover:rotate-6 transition-transform duration-300">π</span>
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight mb-2 text-[var(--text-strong)] flex items-center gap-2">
                Pi Agent Desktop
              </h1>
              <div className="text-[13px] font-mono text-[var(--text-muted)] flex items-center gap-1.5 h-5">
                <span>We are</span>
                <Typewriter phrases={TYPEWRITER_PHRASES} />
              </div>
            </div>

            {/* Feature Action Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mb-8">
              {ACTION_CARDS.map((card, i) => (
                <div
                  key={i}
                  onClick={() => handleEditContent(card.prompt)}
                  className="flex flex-col gap-1.5 p-4 rounded-xl border border-border/40 bg-bg-panel/20 dark:bg-bg-panel/15 hover:bg-bg-panel/60 dark:hover:bg-bg-panel/30 hover:border-accent/40 dark:hover:border-accent/40 hover:-translate-y-[2px] active:scale-95 hover:shadow-popover cursor-pointer transition-all duration-300 select-none group"
                >
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-bg-panel group-hover:bg-accent/10 transition-colors">
                      {card.icon}
                    </div>
                    <span className="font-semibold text-sm text-[var(--text-strong)] group-hover:text-accent transition-colors">
                      {card.title}
                    </span>
                  </div>
                  <p className="text-[12px] text-[var(--text-muted)] leading-relaxed pl-8 group-hover:text-[var(--text)] transition-colors">
                    {card.desc}
                  </p>
                </div>
              ))}
            </div>

            {chatInputElement}

            {/* Drag & Drop Tips */}
            <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-[var(--text-dim)] select-none opacity-80">
              <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span>可以直接拖拽任何文件或文件夹到这里，开始分析与交谈</span>
            </div>

            {/* Version Badges */}
            <div className="flex gap-2 text-[10px] text-[var(--text-dim)] mt-12 justify-center select-none">
              <span className="px-2 py-0.5 rounded-full border border-border/50 bg-bg-panel/30 font-mono">
                web <span className="text-[var(--text-muted)] font-semibold">v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}</span>
              </span>
              <span className="px-2 py-0.5 rounded-full border border-border/50 bg-bg-panel/30 font-mono">
                pi <span className="text-[var(--text-muted)] font-semibold">v{process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}</span>
              </span>
            </div>
          </div>
        </div>
      ) : (
      <>
      <div className="relative flex flex-1 overflow-hidden">
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto pt-4 [scrollbar-width:none]">
          <div className="mx-auto max-w-[820px] px-4">

            <MessageList
              messages={messages}
              entryIds={entryIds}
              toolResultsMap={toolResultsMap}
              nextUserIdx={nextUserIdx}
              nextAssistantIdx={nextAssistantIdx}
              isStreaming={streamState.isStreaming}
              streamingMessage={streamState.streamingMessage}
              isNew={isNew}
              agentRunning={agentRunning}
              forkingEntryId={forkingEntryId}
              onFork={handleFork}
              onNavigate={handleNavigate}
              onEditContent={handleEditContent}
              messageRefs={messageRefs}
              lastUserMsgRef={lastUserMsgRef}
              modelNames={modelNames}
            />

            {agentRunning && !streamState.streamingMessage && (
              <div className="py-2 text-[13px] text-text-muted">
                <span className="animate-[pulse_1.5s_infinite]">{phaseLabel(agentPhase)}</span>
              </div>
            )}

            {agentRunning && (
              <div style={{ height: scrollContainerRef.current ? scrollContainerRef.current.clientHeight : "80vh" }} />
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
        <ChatMinimap
          messages={messages}
          streamingMessage={streamState.streamingMessage}
          scrollContainer={scrollContainerRef}
          messageRefs={messageRefs}
        />
      </div>

      <div className="relative">
        {chatInputElement}
      </div>
      </>
      )}
    </div>
  );
}
