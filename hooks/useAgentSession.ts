"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useReducer,
  useMemo,
} from "react";
import type { SessionInfo, SessionTreeNode, UserMessage } from "@/lib/types";
import type { FollowUpQueueSnapshot } from "@/lib/follow-up-queue";
import { calculateSessionStats } from "./agent-session/session-stats";
import { type AgentPhase } from "./agent-session/agent-phase";
import {
  initialStreamingState,
  streamReducer,
} from "./agent-session/stream-state";
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
import { useSessionCommands } from "./agent-session/use-session-commands";
import type {
  AttachedImage,
  ChatInputHandle,
} from "@/components/chat-input/types";
import type { AgentMode } from "@/lib/approval-policy";
import { DEFAULT_AGENT_MODE } from "@/lib/approval-policy";
import type { ExtensionUiRequestEvent } from "./agent-session/agent-events-manager";
import type { NeedsTrustPayload } from "@/lib/trust-types";
import { sendAgentCommand } from "@/lib/agent-client";
import { reconcileOrAppendPendingUserMessage } from "./agent-session/user-message-reconciliation";

export type { ThinkingLevelOption, AttachedImage, ChatInputHandle };

const EMPTY_FOLLOW_UP_QUEUE: FollowUpQueueSnapshot = { revision: 0, items: [] };

function userMessageText(message: UserMessage): string {
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter(
          (block): block is { type: "text"; text: string } =>
            block.type === "text",
        )
        .map((block) => block.text)
        .join("\n");
}

function clearPendingDelivery(message: UserMessage): UserMessage {
  const delivered = { ...message };
  delete delivered.deliveryState;
  return delivered;
}

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
  onBranchDataChange?: (
    tree: SessionTreeNode[],
    activeLeafId: string | null,
    onLeafChange: (leafId: string | null) => void,
  ) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
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

  const [streamState, dispatch] = useReducer(
    streamReducer,
    initialStreamingState,
  );
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
  const [extensionUiRequest, setExtensionUiRequest] =
    useState<ExtensionUiRequestEvent | null>(null);
  const [extensionUiNotify, setExtensionUiNotify] = useState<{
    message: string;
    notifyType: "info" | "warning" | "error";
  } | null>(null);
  const [trustPrompt, setTrustPrompt] = useState<NeedsTrustPayload | null>(
    null,
  );
  const [followUpQueue, setFollowUpQueue] = useState<FollowUpQueueSnapshot>(
    EMPTY_FOLLOW_UP_QUEUE,
  );
  const [followUpQueueBusy, setFollowUpQueueBusy] = useState(false);
  const followUpQueueRef = useRef(followUpQueue);
  followUpQueueRef.current = followUpQueue;
  const pendingSteersRef = useRef<
    Array<{ id: string; message: string; glowing: boolean }>
  >([]);
  const pendingPromptsRef = useRef<Array<{ id: string; message: string }>>([]);
  const trustResolverRef = useRef<((optionId: string | null) => void) | null>(
    null,
  );
  const agentModeRef = useRef(agentMode);
  agentModeRef.current = agentMode;

  const acceptFollowUpQueue = useCallback((snapshot: FollowUpQueueSnapshot) => {
    if (snapshot.revision < followUpQueueRef.current.revision) return;
    followUpQueueRef.current = snapshot;
    setFollowUpQueue(snapshot);
  }, []);

  const handlePendingSteerQueued = useCallback(
    (item: { id: string; message: string }) => {
      pendingSteersRef.current.push({ ...item, glowing: true });
    },
    [],
  );

  const handlePendingSteerFailed = useCallback(
    (id: string) => {
      pendingSteersRef.current = pendingSteersRef.current.filter(
        (item) => item.id !== id,
      );
      setMessages((prev) =>
        prev.map((message) => {
          if (message.role !== "user" || message.clientMessageId !== id)
            return message;
          return clearPendingDelivery(message);
        }),
      );
    },
    [setMessages],
  );

  const handlePendingPromptQueued = useCallback(
    (item: { id: string; message: string }) => {
      pendingPromptsRef.current.push(item);
    },
    [],
  );

  const handlePendingPromptFailed = useCallback(
    (id: string) => {
      pendingPromptsRef.current = pendingPromptsRef.current.filter(
        (item) => item.id !== id,
      );
      setMessages((prev) =>
        prev.map((message) => {
          if (message.role !== "user" || message.clientMessageId !== id)
            return message;
          return clearPendingDelivery(message);
        }),
      );
    },
    [setMessages],
  );

  const reconcileSteeringQueue = useCallback(
    (steering: readonly string[]) => {
      const remaining = new Map<string, number>();
      for (const message of steering)
        remaining.set(message, (remaining.get(message) ?? 0) + 1);
      const deliveredIds = new Set<string>();
      pendingSteersRef.current = pendingSteersRef.current.map((item) => {
        if (!item.glowing) return item;
        const count = remaining.get(item.message) ?? 0;
        if (count > 0) {
          remaining.set(item.message, count - 1);
          return item;
        }
        deliveredIds.add(item.id);
        return { ...item, glowing: false };
      });
      if (!deliveredIds.size) return;
      setMessages((prev) =>
        prev.map((message) => {
          if (
            message.role !== "user" ||
            !message.clientMessageId ||
            !deliveredIds.has(message.clientMessageId)
          ) {
            return message;
          }
          return clearPendingDelivery(message);
        }),
      );
    },
    [setMessages],
  );

  const {
    messagesEndRef,
    scrollContainerRef,
    lastUserMsgRef,
    pendingScrollToUserRef,
  } = useChatScroll({ messageCount: messages.length, agentRunning });

  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const { handleAgentEventRef, connectEvents, connectionStatus } =
    useAgentEvents({ agentRunning });

  const modelTools = useSessionModelTools({
    isNew,
    modelsRefreshKey,
    sessionIdRef,
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
    [currentModelOverride, data?.context.model, pendingModel],
  );
  const displayModel = useMemo(
    () => (isNew ? newSessionModel : currentModel),
    [isNew, newSessionModel, currentModel],
  );
  const sessionStats = useMemo(
    () => calculateSessionStats(messages),
    [messages],
  );

  const loadSession = useCallback(
    async (sid: string, showLoading = false, includeState = false) => {
      // A canonical transcript replaces any optimistic delivery state. Clear
      // the matching refs first so a later same-text event cannot consume a
      // stale client id and suppress a real message.
      pendingPromptsRef.current = [];
      pendingSteersRef.current = [];
      const loaded = await loadSessionFromApi(sid, showLoading, includeState);
      if (loaded) setCurrentModelOverride(null);
      return loaded;
    },
    [loadSessionFromApi, setCurrentModelOverride],
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
        await sendAgentCommand(sid, {
          type: "extension_ui_response",
          ...payload,
        });
      } catch (e) {
        console.error("extension_ui_response failed:", e);
      }
    },
    [],
  );

  const handleAgentEvent = useCallback(
    (event: Parameters<typeof applyAgentEvent>[0]) => {
      if (event.type === "follow_up_queue_update") {
        acceptFollowUpQueue({ revision: event.revision, items: event.items });
      } else if (event.type === "queue_update") {
        reconcileSteeringQueue(event.steering);
      }

      let reconciledSteerId: string | null = null;
      let reconciledPromptId: string | null = null;
      if (event.type === "message_end" && event.message.role === "user") {
        const canonicalText = userMessageText(event.message);
        const pendingIndex = pendingSteersRef.current.findIndex(
          (item) => item.message === canonicalText,
        );
        if (pendingIndex !== -1) {
          reconciledSteerId = pendingSteersRef.current[pendingIndex].id;
          pendingSteersRef.current.splice(pendingIndex, 1);
        } else {
          const promptIndex = pendingPromptsRef.current.findIndex(
            (item) => item.message === canonicalText,
          );
          if (promptIndex !== -1) {
            reconciledPromptId = pendingPromptsRef.current[promptIndex].id;
            pendingPromptsRef.current.splice(promptIndex, 1);
          }
        }
      }
      const result = applyAgentEvent(event);

      if (
        reconciledSteerId &&
        event.type === "message_end" &&
        event.message.role === "user"
      ) {
        const clientMessageId = reconciledSteerId;
        const canonical = event.message;
        result.appendMessages = undefined;
        setMessages((prev) =>
          prev.map((message) => {
            if (
              message.role !== "user" ||
              message.clientMessageId !== clientMessageId
            )
              return message;
            return { ...canonical, timestamp: message.timestamp };
          }),
        );
      }

      if (
        reconciledPromptId &&
        event.type === "message_end" &&
        event.message.role === "user"
      ) {
        const clientMessageId = reconciledPromptId;
        const canonical = event.message;
        result.appendMessages = undefined;
        setMessages((prev) =>
          reconcileOrAppendPendingUserMessage(prev, canonical, clientMessageId),
        );
        setEntryIds((prev) => [...prev, undefined]);
      }

      if (result.agentRunning !== undefined)
        setAgentRunning(result.agentRunning);
      if (result.phaseOp) {
        setAgentPhase((prev) => applyPhaseOp(prev, result.phaseOp!));
      }
      if (result.streamAction) dispatch(result.streamAction);
      if (result.retryInfo !== undefined) setRetryInfo(result.retryInfo);
      if (result.isCompacting !== undefined)
        setIsCompacting(result.isCompacting);
      if (result.compactError !== undefined)
        setCompactError(result.compactError);
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
        setEntryIds((prev) => [...prev, ...appended.map(() => undefined)]);
        if (agentModeRef.current === "plan") {
          const last = appended[appended.length - 1];
          if (last && last.role === "assistant") {
            const text =
              typeof last.content === "string"
                ? last.content
                : Array.isArray(last.content)
                  ? last.content
                      .filter(
                        (b): b is { type: "text"; text: string } =>
                          b.type === "text",
                      )
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
                      followUpQueue?: FollowUpQueueSnapshot;
                    };
                  }) => {
                    if (d.state?.contextUsage !== undefined) {
                      setContextUsage(d.state.contextUsage ?? null);
                    }
                    if (d.state?.systemPrompt !== undefined) {
                      setSystemPrompt(d.state.systemPrompt ?? null);
                    }
                    if (d.state?.agentMode) setAgentMode(d.state.agentMode);
                    if (d.state?.followUpQueue)
                      acceptFollowUpQueue(d.state.followUpQueue);
                  },
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
    [
      acceptFollowUpQueue,
      loadSession,
      onAgentEnd,
      onAgentEndEvent,
      reconcileSteeringQueue,
      setMessages,
      setEntryIds,
      setCanExecutePlan,
    ],
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
    onFollowUpQueueSnapshot: acceptFollowUpQueue,
    onPendingSteerQueued: handlePendingSteerQueued,
    onPendingSteerFailed: handlePendingSteerFailed,
    onPendingPromptQueued: handlePendingPromptQueued,
    onPendingPromptFailed: handlePendingPromptFailed,
  });

  const handleReorderFollowUps = useCallback(
    async (orderedIds: string[]) => {
      if (followUpQueueBusy) return;
      const previous = followUpQueueRef.current;
      if (
        orderedIds.length !== previous.items.length ||
        orderedIds.every((id, index) => id === previous.items[index]?.id)
      )
        return;
      const byId = new Map(previous.items.map((item) => [item.id, item]));
      const optimistic: FollowUpQueueSnapshot = {
        revision: previous.revision,
        items: orderedIds
          .map((id) => byId.get(id))
          .filter((item): item is FollowUpQueueSnapshot["items"][number] =>
            Boolean(item),
          ),
      };
      if (optimistic.items.length !== previous.items.length) return;
      followUpQueueRef.current = optimistic;
      setFollowUpQueue(optimistic);
      setFollowUpQueueBusy(true);
      const sid = sessionIdRef.current;
      if (!sid) {
        acceptFollowUpQueue(previous);
        setFollowUpQueueBusy(false);
        return;
      }
      try {
        const snapshot = await sendAgentCommand<FollowUpQueueSnapshot>(sid, {
          type: "reorder_follow_ups",
          orderedIds,
          expectedRevision: previous.revision,
        });
        acceptFollowUpQueue(snapshot);
      } catch (error) {
        console.error("Failed to reorder follow-ups:", error);
        try {
          const state = await sendAgentCommand<{
            followUpQueue?: FollowUpQueueSnapshot;
          }>(sid, { type: "get_state" });
          if (state.followUpQueue) acceptFollowUpQueue(state.followUpQueue);
        } catch {
          if (followUpQueueRef.current.revision === previous.revision) {
            followUpQueueRef.current = previous;
            setFollowUpQueue(previous);
          }
        }
      } finally {
        setFollowUpQueueBusy(false);
      }
    },
    [acceptFollowUpQueue, followUpQueueBusy, sessionIdRef],
  );

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
    followUpQueueRef.current = EMPTY_FOLLOW_UP_QUEUE;
    setFollowUpQueue(EMPTY_FOLLOW_UP_QUEUE);
    setFollowUpQueueBusy(false);
    pendingSteersRef.current = [];
    pendingPromptsRef.current = [];

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
      if (patch.thinkingLevel !== undefined)
        setThinkingLevel(patch.thinkingLevel);
      if (patch.loadTools) loadTools(sid);
      if (patch.agentRunning) setAgentRunning(true);
      if (patch.agentPhaseWaitingModel)
        setAgentPhase({ kind: "waiting_model" });
      if (patch.connectEvents) connectEvents(sid);
      if (patch.isCompacting !== undefined) setIsCompacting(patch.isCompacting);
      if (patch.contextUsage !== undefined) setContextUsage(patch.contextUsage);
      if (patch.systemPrompt !== undefined) setSystemPrompt(patch.systemPrompt);
      const loadedQueue = loaded?.agentState?.state?.followUpQueue;
      if (loadedQueue) acceptFollowUpQueue(loadedQueue);
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
    onBranchDataChange(
      data?.tree ?? [],
      activeLeafId,
      commands.handleLeafChange,
    );
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
      .then(
        (d: {
          defaultAgentMode?: AgentMode;
          defaultToolPreset?: "none" | "default" | "full";
        }) => {
          if (d.defaultAgentMode) setAgentMode(d.defaultAgentMode);
          if (d.defaultToolPreset) setToolPreset(d.defaultToolPreset);
        },
      )
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
    loading,
    error,
    messages,
    entryIds,
    streamState,
    agentRunning,
    modelNames,
    modelList,
    modelThinkingLevels,
    modelThinkingLevelMaps,
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
    displayModel,
    sessionStats,
    agentPhase,
    followUpQueue,
    followUpQueueBusy,
    isNew,
    // Refs
    messagesEndRef,
    scrollContainerRef,
    lastUserMsgRef,
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
    handleReorderFollowUps,
    handleAbortCompaction: commands.handleAbortCompaction,
    handleToolPresetChange,
    handleThinkingLevelChange,
    connectEvents,
    connectionStatus,
  };
}
