"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { SessionInfo, SessionTreeNode, ToolResultMessage } from "@/lib/types";
import { splitActiveThinking } from "@/lib/active-thinking";
import { MessageList } from "./MessageList";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ExtensionUiDialog } from "./ExtensionUiDialog";
import { ProjectTrustDialog } from "./ProjectTrustDialog";
import { ExecutePlanBar } from "./ExecutePlanBar";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import { BranchCloneModal, type BranchCloneMode } from "./BranchCloneModal";
import { useAgentSession } from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { AgentThinkingOrb } from "./AgentThinkingOrb";
import { useDragDrop } from "@/hooks/useDragDrop";
import { formatDroppedPathMentions, getDroppedFilePath } from "@/lib/file-paths";
import { useI18n } from "./I18nProvider";
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

export function ChatWindow({ session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSessionStatsChange, onContextUsageChange }: Props) {
  const { t } = useI18n();
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
    followUpQueue, followUpQueueBusy,
    isNew,
    agentMode,
    canExecutePlan,
    extensionUiRequest,
    extensionUiNotify,
    trustPrompt,
    resolveTrustPrompt,
    handleExtensionUiRespond,
    messagesEndRef, scrollContainerRef,
    lastUserMsgRef,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handleAbortCompaction,
    handleReorderFollowUps,
    handleToolPresetChange, handleThinkingLevelChange,
    handleAgentModeChange, handleExecutePlan,
    connectEvents, connectionStatus,
  } = useAgentSession({
    session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, onBranchDataChange, onSystemPromptChange,
    onAgentEndEvent: handleAgentEndEvent,
  });

  const [branchCloneModal, setBranchCloneModal] = useState<{
    isOpen: boolean;
    mode: BranchCloneMode;
    targetEntryId?: string;
  }>({ isOpen: false, mode: "branch" });

  const handleBranchMessage = useCallback((entryId: string) => {
    setBranchCloneModal({ isOpen: true, mode: "branch", targetEntryId: entryId });
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
    if (!files.length) return;

    const cwd = session?.cwd ?? newSessionCwd;
    const absolutePaths = files
      .map((file) => getDroppedFilePath(file))
      .filter((path): path is string => Boolean(path));
    const mentions = formatDroppedPathMentions(absolutePaths, cwd);
    if (mentions) chatInputRef?.current?.insertText(mentions);

    // Keep multimodal image attach for vision models; paths still go in as @mentions above.
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length) chatInputRef?.current?.addImages(images);
  }, [chatInputRef, session?.cwd, newSessionCwd]);

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

  const { activeThinking, visibleStreamingMessage } = useMemo(
    () => splitActiveThinking(streamState.streamingMessage),
    [streamState.streamingMessage]
  );

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
    <>
      <ExecutePlanBar
        visible={canExecutePlan && agentMode === "plan" && !agentRunning}
        disabled={agentRunning}
        onExecute={handleExecutePlan}
      />
      <ChatInput
        ref={chatInputRef}
        onSend={handleSend}
        onAbort={handleAbort}
        onSteer={agentRunning ? handleSteer : undefined}
        onFollowUp={agentRunning ? handleFollowUp : undefined}
        followUpQueue={followUpQueue}
        followUpQueueBusy={followUpQueueBusy}
        onReorderFollowUps={handleReorderFollowUps}
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
        agentMode={agentMode}
        onAgentModeChange={session || isNew ? handleAgentModeChange : undefined}
        thinkingLevel={thinkingLevel}
        onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
        availableThinkingLevels={availableThinkingLevels}
        thinkingLevelMap={currentThinkingLevelMap}
        retryInfo={retryInfo}
        soundEnabled={soundEnabled}
        onSoundToggle={onSoundToggle}
      />
    </>
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
      <ExtensionUiDialog request={extensionUiRequest} onRespond={handleExtensionUiRespond} />
      <ProjectTrustDialog
        payload={trustPrompt}
        onChoose={(id) => resolveTrustPrompt(id)}
        onCancel={() => resolveTrustPrompt(null)}
      />
      {extensionUiNotify && (
        <div
          className="t-toast is-open material-popover absolute top-3 left-1/2 z-[60] rounded-panel border border-border px-3 py-2 text-[12px] text-text shadow-popover"
          style={{ "--toast-x": "-50%" } as React.CSSProperties}
          role="status"
        >
          {extensionUiNotify.message}
        </div>
      )}
      {connectionStatus === "failed" && (
        <div className="bg-danger-bg border-b border-danger-border px-4 py-2.5 flex items-center justify-between text-[12px] text-danger shrink-0 z-50">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{t("chat.connectionLost")}</span>
          </div>
          <button
            onClick={handleReconnect}
            className="px-2.5 py-1 bg-danger text-accent-contrast rounded-control cursor-pointer hover:bg-danger-hover transition-colors font-medium text-[11px]"
          >
            {t("chat.reconnect")}
          </button>
        </div>
      )}
      {isDragOver && (
        <div
          className="pointer-events-none absolute inset-0 z-50 grid place-items-center backdrop-blur-sm"
          style={{ background: "color-mix(in srgb, var(--bg) 72%, transparent)" }}
        >
          <div className="t-modal is-open material-popover flex items-center gap-3 rounded-[16px] border border-info-border px-5 py-4 text-info shadow-popover">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-info-bg">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4" /><polyline points="7 9 12 4 17 9" /><path d="M5 20h14" />
              </svg>
            </div>
            <div>
              <div className="text-[13px] font-medium text-text">{t("branch.addConversation")}</div>
              <div className="mt-0.5 text-[11px] text-text-muted">{t("chat.dropHint")}</div>
            </div>
          </div>
        </div>
      )}

      {isEmptyNew ? (
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-10 md:py-16">
          <div className="flex w-full max-w-[820px] flex-col justify-center">
            <div className="mb-8 flex justify-center select-none">
              <Image
                src="/logo.png"
                alt=""
                aria-hidden="true"
                width={64}
                height={64}
                priority
                draggable={false}
                className="h-16 w-16 rounded-[18px] shadow-sm"
              />
            </div>

            {chatInputElement}
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
              streamingMessage={visibleStreamingMessage}
              isNew={isNew}
              agentRunning={agentRunning}
              forkingEntryId={forkingEntryId}
              onFork={handleFork}
              onNavigate={handleNavigate}
              onBranchMessage={handleBranchMessage}
              onEditContent={handleEditContent}
              messageRefs={messageRefs}
              lastUserMsgRef={lastUserMsgRef}
              modelNames={modelNames}
              activeAgentIndicator={agentRunning
                ? <AgentThinkingOrb phase={agentPhase} thinking={activeThinking} />
                : null}
            />

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
      <BranchCloneModal
        isOpen={branchCloneModal.isOpen}
        onClose={() => setBranchCloneModal((prev) => ({ ...prev, isOpen: false }))}
        mode={branchCloneModal.mode}
        sessionId={session?.id ?? null}
        targetEntryId={branchCloneModal.targetEntryId}
        cwd={session?.cwd ?? newSessionCwd ?? undefined}
        onSuccess={(newSessionId) => {
          onSessionForked?.(newSessionId);
        }}
      />
    </div>
  );
}
