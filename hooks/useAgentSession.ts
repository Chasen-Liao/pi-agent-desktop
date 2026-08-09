"use client";

import { useState, useCallback, useRef, useEffect, useReducer, useMemo } from "react";
import type { AgentMessage, SessionInfo, SessionTreeNode } from "@/lib/types";
import { calculateSessionStats } from "./agent-session/session-stats";
import { type AgentPhase } from "./agent-session/agent-phase";
import { initialStreamingState, streamReducer } from "./agent-session/stream-state";
import { useChatScroll } from "./agent-session/use-chat-scroll";
import { useAgentEvents } from "./agent-session/use-agent-events";
import { useSessionLoader } from "./agent-session/use-session-loader";
import {
  applyAgentEvent,
  applyPhaseOp,
  type ContextUsage,
  type RetryInfo,
} from "./agent-session/agent-event-apply";
import {
  sessionScopedResetPatch,
  loadedAgentStatePatch,
  type ThinkingLevelOption,
} from "./agent-session/session-lifecycle-reset";
import { useSessionModelTools } from "./agent-session/use-session-model-tools";
import {
  useSessionCommands,
  type AttachedImage,
} from "./agent-session/use-session-commands";
import type { AgentMode } from "@/lib/approval-policy";
import { DEFAULT_AGENT_MODE } from "@/lib/approval-policy";
import type { ExtensionUiRequestEvent } from "./agent-session/agent-events-manager";
import type { NeedsTrustPayload } from "@/lib/trust-types";
import { sendAgentCommand } from "@/lib/agent-client";

export type { ThinkingLevelOption };
export type { AttachedImage };

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  /** Called inside the agent_end event handler, BEFORE business logic (state updates).
   *  Use this for side effects that should fire on every agent_end event
   *  (e.g., notification sounds). Distinct from onAgentEnd which is the
   *  parent-component-facing callback. */
  onAgentEndEvent?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (
    tree: SessionTreeNode[],
    activeLeafId: string | null,
    onLeafChange: (leafId: string | null) => void
  ) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  setNewSessionModel?: (model: { provider: string; modelId: string } | null) => void;
  setToolPreset?: (preset: "none" | "default" | "full") => void;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  addImages: (files: File[]) => void;
}

export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session,
    newSessionCwd,
    onAgentEnd,
    onAgentEndEvent,
    onSessionCreated,
    onSessionForked,
    modelsRefreshKey,
    onBranchDataChange,
    onSystemPromptChange,
  } = opts;

  const isNew = session === null && newSessionCwd !== null;

  const {
    data,
    setData,
    loading,
    error,
    activeLeafId,
    setActiveLeafId,
    messages,
    setMessages,
    entryIds,
    setEntryIds,
    loadSession: loadSessionFromApi,
    loadContext,
  } = useSessionLoader(isNew);

  const [streamState, dispatch] = useReducer(streamReducer, initialStreamingState);
  const [agentRunning, setAgentRunning] = useState(false);
  const [retryInfo, setRetryInfo] = useState<RetryInfo | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
  const [agentMode, setAgentMode] = useState<AgentMode>(DEFAULT_AGENT_MODE);
  const [canExecutePlan, setCanExecutePlan] = useState(false);
  const [extensionUiRequest, setExtensionUiRequest] = useState<ExtensionUiRequestEvent | null>(null);
  const [extensionUiNotify, setExtensionUiNotify] = useState<{
    message: string;
    notifyType: "info" | "warning" | "error";
  } | null>(null);
  const [trustPrompt, setTrustPrompt] = useState<NeedsTrustPayload | null>(null);
  const trustResolverRef = useRef<((optionId: string | null) => void) | null>(null);
  const agentModeRef = useRef(agentMode);
  agentModeRef.current = agentMode;

  const {
    messagesEndRef,
    scrollContainerRef,
    lastUserMsgRef,
    pendingScrollToUserRef,
    initialScrollDoneRef,
  } = useChatScroll({ messageCount: messages.length, agentRunning });

  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const {
    eventSourceRef,
    handleAgentEventRef,
    connectEvents,
    connectionStatus,
  } = useAgentEvents({ agentRunning });

  const modelTools = useSessionModelTools({
    isNew,
    modelsRefreshKey,
    sessionIdRef,
    setNewSessionModelExternal: opts.setNewSessionModel,
    setToolPresetExternal: opts.setToolPreset,
  });

  const {
    modelNames,
    modelList,
    modelThinkingLevels,
    modelThinkingLevelMaps,
    newSessionModel,
    toolPreset,
    setToolPreset,
    thinkingLevel,
    setThinkingLevel,
    currentModelOverride,
    setCurrentModelOverride,
    pendingModel,
    setPendingModel,
    loadTools,
    handleModelChange,
    handleThinkingLevelChange,
    handleToolPresetChange,
  } = modelTools;

  const currentModel = useMemo(
    () => currentModelOverride ?? data?.context.model ?? pendingModel ?? null,
    [currentModelOverride, data?.context.model, pendingModel]
  );
  const displayModel = useMemo(
    () => (isNew ? newSessionModel : currentModel),
    [isNew, newSessionModel, currentModel]
  );
  const sessionStats = useMemo(() => calculateSessionStats(messages), [messages]);

  const loadSession = useCallback(
    async (sid: string, showLoading = false, includeState = false) => {
      const loaded = await loadSessionFromApi(sid, showLoading, includeState);
      if (loaded) setCurrentModelOverride(null);
      return loaded;
    },
    [loadSessionFromApi, setCurrentModelOverride]
  );

  const promptTrust = useCallback((payload: NeedsTrustPayload) => {
    return new Promise<string | null>((resolve) => {
      trustResolverRef.current = resolve;
      setTrustPrompt(payload);
    });
  }, []);

  const resolveTrustPrompt = useCallback((optionId: string | null) => {
    setTrustPrompt(null);
    const r = trustResolverRef.current;
    trustResolverRef.current = null;
    r?.(optionId);
  }, []);

  const handleExtensionUiRespond = useCallback(
    async (payload: {
      id: string;
      confirmed?: boolean;
      value?: string;
      cancelled?: boolean;
    }) => {
      setExtensionUiRequest(null);
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "extension_ui_response", ...payload });
      } catch (e) {
        console.error("extension_ui_response failed:", e);
      }
    },
    []
  );

  const handleAgentEvent = useCallback(
    (event: Parameters<typeof applyAgentEvent>[0]) => {
      const result = applyAgentEvent(event);

      if (result.agentRunning !== undefined) setAgentRunning(result.agentRunning);
      if (result.phaseOp) {
        setAgentPhase((prev) => applyPhaseOp(prev, result.phaseOp!));
      }
      if (result.streamAction) dispatch(result.streamAction);
      if (result.retryInfo !== undefined) setRetryInfo(result.retryInfo);
      if (result.isCompacting !== undefined) setIsCompacting(result.isCompacting);
      if (result.compactError !== undefined) setCompactError(result.compactError);
      if (result.appendMessages?.length) {
        const appended = result.appendMessages!;
        // Pure updater: a side-effect-free spread (React StrictMode can
        // double-invoke updaters during render, so setCanExecutePlan must live
        // outside the updater, below).
        setMessages((prev) => [...prev, ...appended]);
        // Keep entryIds parallel with messages. SSE message events don't carry
        // the session entry id, so the new slots stay undefined until the next
        // reload populates real ids; MessageList falls back to idx keys, gates
        // fork/navigate on a truthy entryId, and handleFork guards empty ids.
        setEntryIds((prev) => [...prev, ...appended.map(() => undefined as unknown as string)]);
        if (agentModeRef.current === "plan") {
          const last = appended[appended.length - 1];
          if (last && last.role === "assistant") {
            const text =
              typeof last.content === "string"
                ? last.content
                : Array.isArray(last.content)
                  ? last.content
                      .filter((b): b is { type: "text"; text: string } => b.type === "text")
                      .map((b) => b.text)
                      .join("")
                  : "";
            if (text.trim()) setCanExecutePlan(true);
          }
        }
      }

      for (const effect of result.effects) {
        switch (effect.type) {
          case "onAgentEndEvent":
            onAgentEndEvent?.();
            break;
          case "onAgentEnd":
            onAgentEnd?.();
            break;
          case "reloadSession":
            if (sessionIdRef.current) loadSession(sessionIdRef.current);
            break;
          case "fetchAgentState":
            if (sessionIdRef.current) {
              fetch(`/api/agent/${encodeURIComponent(sessionIdRef.current)}`)
                .then((r) => r.json())
                .then(
                  (d: {
                    state?: {
                      contextUsage?: ContextUsage | null;
                      systemPrompt?: string;
                      agentMode?: AgentMode;
                    };
                  }) => {
                    if (d.state?.contextUsage !== undefined) {
                      setContextUsage(d.state.contextUsage ?? null);
                    }
                    if (d.state?.systemPrompt !== undefined) {
                      setSystemPrompt(d.state.systemPrompt ?? null);
                    }
                    if (d.state?.agentMode) setAgentMode(d.state.agentMode);
                  }
                )
                .catch((err) => {
                  console.error("Agent end fetch failed:", err);
                });
            }
            break;
          case "consoleError":
            console.error("Agent error from server:", effect.message);
            break;
          case "extensionUiRequest":
            setExtensionUiRequest(effect.request);
            break;
          case "extensionUiNotify":
            setExtensionUiNotify({
              message: effect.message,
              notifyType: effect.notifyType,
            });
            break;
        }
      }
    },
    [loadSession, onAgentEnd, onAgentEndEvent, setMessages, setEntryIds, setCanExecutePlan]
  );
  handleAgentEventRef.current = handleAgentEvent;

  const commands = useSessionCommands({
    session,
    newSessionCwd,
    isNew,
    agentRunning,
    isCompacting,
    toolPreset,
    agentMode,
    setAgentMode,
    thinkingLevel,
    newSessionModel,
    sessionIdRef,
    pendingScrollToUserRef,
    setMessages,
    setAgentRunning,
    setAgentPhase,
    dispatch,
    setPendingModel,
    setIsCompacting,
    setCompactError,
    setForkingEntryId,
    setActiveLeafId,
    setCanExecutePlan,
    promptTrust,
    loadSession,
    loadContext,
    connectEvents,
    onSessionCreated,
    onSessionForked,
  });

  // Load session on mount AND on session change.
  //
  // On session change, reset all session-scoped state to avoid bleed
  // from a previous session. AppShell's sessionKey remount is kept
  // as defense-in-depth (covers state in sub-hooks like
  // useChatScroll / useAgentEvents that we can't reset from here).
  useEffect(() => {
    if (!session) return;
    const sid = session.id;
    sessionIdRef.current = sid;
    let cancelled = false;

    const reset = sessionScopedResetPatch();
    setData(null);
    setActiveLeafId(null);
    setMessages([]);
    setEntryIds([]);
    setToolPreset(reset.toolPreset);
    setThinkingLevel(reset.thinkingLevel);
    setAgentRunning(reset.agentRunning);
    setAgentPhase(reset.agentPhase);
    dispatch({ type: "reset" });
    setRetryInfo(reset.retryInfo);
    setContextUsage(reset.contextUsage);
    setSystemPrompt(reset.systemPrompt);
    setForkingEntryId(reset.forkingEntryId);
    setIsCompacting(reset.isCompacting);
    setCompactError(reset.compactError);
    setCurrentModelOverride(reset.currentModelOverride);
    setPendingModel(reset.pendingModel);
    setAgentMode(DEFAULT_AGENT_MODE);
    setCanExecutePlan(false);
    setExtensionUiRequest(null);

    fetch("/api/desktop-settings")
      .then((r) => r.json())
      .then((d: { defaultAgentMode?: AgentMode }) => {
        if (!cancelled && d.defaultAgentMode) setAgentMode(d.defaultAgentMode);
      })
      .catch(() => {});

    loadSessionFromApi(sid, true, true).then((loaded) => {
      if (cancelled) return;
      const patch = loadedAgentStatePatch({
        agentState: loaded?.agentState ?? null,
        contextThinkingLevel: loaded?.contextThinkingLevel ?? null,
      });
      if (patch.thinkingLevel !== undefined) setThinkingLevel(patch.thinkingLevel);
      if (patch.loadTools) loadTools(sid);
      if (patch.agentRunning) setAgentRunning(true);
      if (patch.agentPhaseWaitingModel) setAgentPhase({ kind: "waiting_model" });
      if (patch.connectEvents) connectEvents(sid);
      if (patch.isCompacting !== undefined) setIsCompacting(patch.isCompacting);
      if (patch.contextUsage !== undefined) setContextUsage(patch.contextUsage);
      if (patch.systemPrompt !== undefined) setSystemPrompt(patch.systemPrompt);
    });

    return () => {
      cancelled = true;
    };
    // useState setters are reference-stable but exhaustive-deps
    // doesn't recognize them as such; deps is intentionally
    // [session?.id] only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  useEffect(() => {
    onSystemPromptChange?.(systemPrompt);
  }, [systemPrompt, onSystemPromptChange]);

  useEffect(() => {
    if (!onBranchDataChange) return;
    onBranchDataChange(data?.tree ?? [], activeLeafId, commands.handleLeafChange);
  }, [data?.tree, activeLeafId, commands.handleLeafChange, onBranchDataChange]);

  // Compact error auto-dismiss
  useEffect(() => {
    if (!compactError) return;
    const t = setTimeout(() => setCompactError(null), 3000);
    return () => clearTimeout(t);
  }, [compactError]);

  // Load global default mode for brand-new sessions
  useEffect(() => {
    if (!isNew) return;
    fetch("/api/desktop-settings")
      .then((r) => r.json())
      .then((d: { defaultAgentMode?: AgentMode; defaultToolPreset?: "none" | "default" | "full" }) => {
        if (d.defaultAgentMode) setAgentMode(d.defaultAgentMode);
        if (d.defaultToolPreset) setToolPreset(d.defaultToolPreset);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  // Auto-clear notify toast
  useEffect(() => {
    if (!extensionUiNotify) return;
    const t = setTimeout(() => setExtensionUiNotify(null), 4000);
    return () => clearTimeout(t);
  }, [extensionUiNotify]);

  return {
    // State
    data,
    loading,
    error,
    activeLeafId,
    messages,
    entryIds,
    streamState,
    agentRunning,
    modelNames,
    modelList,
    modelThinkingLevels,
    modelThinkingLevelMaps,
    newSessionModel,
    agentMode,
    canExecutePlan,
    extensionUiRequest,
    extensionUiNotify,
    trustPrompt,
    resolveTrustPrompt,
    handleExtensionUiRespond,
    toolPreset,
    thinkingLevel,
    retryInfo,
    contextUsage,
    systemPrompt,
    forkingEntryId,
    isCompacting,
    compactError,
    currentModel,
    displayModel,
    sessionStats,
    agentPhase,
    isNew,
    // Refs
    sessionIdRef,
    eventSourceRef,
    messagesEndRef,
    scrollContainerRef,
    lastUserMsgRef,
    pendingScrollToUserRef,
    initialScrollDoneRef,
    // Actions
    handleSend: commands.handleSend,
    handleAgentModeChange: commands.handleAgentModeChange,
    handleExecutePlan: commands.handleExecutePlan,
    handleAbort: commands.handleAbort,
    handleFork: commands.handleFork,
    handleNavigate: commands.handleNavigate,
    handleModelChange,
    handleCompact: commands.handleCompact,
    handleSteer: commands.handleSteer,
    handleFollowUp: commands.handleFollowUp,
    handleAbortCompaction: commands.handleAbortCompaction,
    handleToolPresetChange,
    handleThinkingLevelChange,
    loadTools,
    setActiveLeafId,
    setData,
    setMessages,
    dispatch,
    setAgentRunning,
    setForkingEntryId,
    connectEvents,
    connectionStatus,
    // Subscriptions
    handleAgentEventRef,
  };
}
