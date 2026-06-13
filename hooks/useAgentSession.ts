"use client";

import { useState, useCallback, useRef, useEffect, useReducer, useMemo } from "react";
import type { AgentMessage, SessionInfo, SessionTreeNode } from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ToolEntry } from "@/components/ToolPanel";
import { calculateSessionStats } from "./agent-session/session-stats";
import { addRunningTool, removeRunningTool, type AgentPhase } from "./agent-session/agent-phase";
import { initialStreamingState, streamReducer } from "./agent-session/stream-state";
import { useChatScroll } from "./agent-session/use-chat-scroll";
import { useAgentEvents, type AgentEvent } from "./agent-session/use-agent-events";
import { useSessionLoader } from "./agent-session/use-session-loader";

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  setNewSessionModel?: (model: { provider: string; modelId: string } | null) => void;
  setToolPreset?: (preset: "none" | "default" | "full") => void;
}

export type ThinkingLevelOption = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  addImages: (files: File[]) => void;
}

export interface AttachedImage {
  data: string;
  mimeType: string;
  previewUrl: string;
}

export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, onBranchDataChange, onSystemPromptChange,
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
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [newSessionModel, setNewSessionModelState] = useState<{ provider: string; modelId: string } | null>(null);
  const [toolPreset, setToolPreset] = useState<"none" | "default" | "full">("default");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("auto");
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; errorMessage?: string } | null>(null);
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<{ provider: string; modelId: string } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
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
  } = useAgentEvents({ agentRunning });

  const setNewSessionModel = opts.setNewSessionModel ?? setNewSessionModelState;
  const setToolPresetState = opts.setToolPreset ?? setToolPreset;

  const currentModel = useMemo(
    () => currentModelOverride ?? data?.context.model ?? pendingModel ?? null,
    [currentModelOverride, data?.context.model, pendingModel]
  );
  const displayModel = useMemo(
    () => isNew ? newSessionModel : currentModel,
    [isNew, newSessionModel, currentModel]
  );
  const sessionStats = useMemo(() => calculateSessionStats(messages), [messages]);

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false) => {
    const loaded = await loadSessionFromApi(sid, showLoading, includeState);
    if (loaded) setCurrentModelOverride(null);
    return loaded;
  }, [loadSessionFromApi]);

  const loadTools = useCallback(async (sid: string) => {
    try {
      const tools = await sendAgentCommand<ToolEntry[]>(sid, { type: "get_tools" });
      if (tools && sessionIdRef.current === sid) {
        const { getPresetFromTools } = await import("@/components/ToolPanel");
        setToolPresetState(getPresetFromTools(tools));
      }
    } catch (e) {
      console.error("Failed to load tools:", e);
    }
  }, [setToolPresetState]);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "agent_start":
        setAgentRunning(true);
        setAgentPhase({ kind: "waiting_model" });
        dispatch({ type: "start" });
        break;
      case "agent_end":
        setAgentRunning(false);
        setAgentPhase(null);
        setRetryInfo(null);
        dispatch({ type: "end" });
        if (sessionIdRef.current) {
          loadSession(sessionIdRef.current);
          fetch(`/api/agent/${encodeURIComponent(sessionIdRef.current)}`)
            .then((r) => r.json())
            .then((d: { state?: { contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null; systemPrompt?: string } }) => {
              if (d.state?.contextUsage !== undefined) setContextUsage(d.state.contextUsage ?? null);
              if (d.state?.systemPrompt !== undefined) setSystemPrompt(d.state.systemPrompt ?? null);
            })
            .catch((err) => { console.error("Agent end fetch failed:", err); });
        }
        onAgentEnd?.();
        break;
      case "message_start":
      case "message_update": {
        const msg = event.message as Partial<AgentMessage> | undefined;
        if (msg) {
          dispatch({ type: "update", message: normalizeToolCalls(msg as AgentMessage) });
        }
        setAgentPhase(null);
        break;
      }
      case "message_end": {
        const completed = event.message as AgentMessage | undefined;
        if (completed) {
          setMessages((prev) => [...prev, normalizeToolCalls(completed)]);
        }
        dispatch({ type: "reset" });
        setAgentPhase({ kind: "waiting_model" });
        break;
      }
      case "tool_execution_start": {
        const id = event.toolCallId as string;
        const name = event.toolName as string;
        setAgentPhase((prev) => addRunningTool(prev, id, name));
        break;
      }
      case "tool_execution_end": {
        const id = event.toolCallId as string;
        setAgentPhase((prev) => removeRunningTool(prev, id));
        break;
      }
      case "auto_retry_start":
        setRetryInfo({ attempt: event.attempt as number, maxAttempts: event.maxAttempts as number, errorMessage: event.errorMessage as string | undefined });
        break;
      case "auto_retry_end":
        setRetryInfo(null);
        break;
      case "auto_compaction_start":
      case "compaction_start":
        setIsCompacting(true);
        setCompactError(null);
        break;
      case "auto_compaction_end":
      case "compaction_end":
        setIsCompacting(false);
        if (event.errorMessage) {
          setCompactError(event.errorMessage as string);
        } else if (!event.aborted) {
          if (sessionIdRef.current) loadSession(sessionIdRef.current);
        }
        break;
    }
  }, [loadSession, onAgentEnd, setMessages]);
  handleAgentEventRef.current = handleAgentEvent;

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]) => {
    if (!message.trim() && !images?.length) return;
    if (agentRunning) return;

    const imageBlocks = images?.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType, data: img.data } }));
    const userMsg: AgentMessage = {
      role: "user",
      content: imageBlocks?.length
        ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks]
        : message,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setAgentRunning(true);
    setAgentPhase({ kind: "waiting_model" });
    dispatch({ type: "start" });
    pendingScrollToUserRef.current = true;

    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));

    try {
      if (isNew && newSessionCwd) {
        const selectedModel = newSessionModel;
        if (selectedModel) setPendingModel(selectedModel);
        const { PRESET_NONE, PRESET_DEFAULT, PRESET_FULL } = await import("@/components/ToolPanel");
        const toolNames = toolPreset === "none" ? PRESET_NONE : toolPreset === "default" ? PRESET_DEFAULT : PRESET_FULL;
        const res = await fetch("/api/agent/new", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd: newSessionCwd,
            type: "prompt",
            message,
            toolNames,
            ...(piImages?.length ? { images: piImages } : {}),
            ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
            ...(thinkingLevel !== "auto" ? { thinkingLevel } : {}),
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json() as { sessionId: string };
        const realId = result.sessionId;
        sessionIdRef.current = realId;
        connectEvents(realId);
        onSessionCreated?.({
          id: realId,
          path: "",
          cwd: newSessionCwd,
          name: undefined,
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          messageCount: 1,
          firstMessage: message,
        });
      } else if (session) {
        connectEvents(session.id);
        await sendAgentCommand(session.id, {
          type: "prompt",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
        });
      }
    } catch (e) {
      console.error("Failed to send message:", e);
      setAgentRunning(false);
      setAgentPhase(null);
      dispatch({ type: "end" });
    }
  }, [isNew, newSessionCwd, newSessionModel, toolPreset, thinkingLevel, session, agentRunning, connectEvents, onSessionCreated, pendingScrollToUserRef, setMessages]);

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, []);

  const handleFork = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setForkingEntryId(entryId);
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sid, {
        type: "fork",
        entryId,
      });
      const { cancelled, newSessionId } = result ?? {};
      if (!cancelled && newSessionId) {
        onSessionForked?.(newSessionId);
      }
    } catch (e) {
      console.error("Fork failed:", e);
    } finally {
      setForkingEntryId(null);
    }
  }, [onSessionForked]);

  const navigateToLeaf = useCallback(async (leafId: string | null) => {
    if (!leafId) {
      setActiveLeafId(null);
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean }>(sid, {
        type: "navigate_tree",
        targetId: leafId,
      });
      if (result?.cancelled) {
        console.warn("navigate_tree cancelled:", leafId);
        return;
      }
      setActiveLeafId(leafId);
      await loadContext(sid, leafId);
    } catch (e) {
      console.error("navigate_tree failed:", e);
    }
  }, [loadContext, setActiveLeafId]);

  const handleNavigate = useCallback((entryId: string) => {
    return navigateToLeaf(entryId);
  }, [navigateToLeaf]);

  const handleLeafChange = useCallback((leafId: string | null) => {
    return navigateToLeaf(leafId);
  }, [navigateToLeaf]);

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    if (isNew) {
      setNewSessionModel({ provider, modelId });
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      setCurrentModelOverride({ provider, modelId });
    } catch (e) {
      console.error("Failed to set model:", e);
    }
  }, [isNew, setNewSessionModel]);

  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isCompacting) return;
    setIsCompacting(true);
    setCompactError(null);
    try {
      await sendAgentCommand(sid, { type: "compact" });
      await loadSession(sid, true);
    } catch (e) {
      setCompactError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsCompacting(false);
    }
  }, [isCompacting, loadSession]);

  const handleSteer = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setMessages((prev) => [...prev, { role: "user", content: `[steer] ${message}`, timestamp: Date.now() } as AgentMessage]);
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "steer",
        message,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to steer:", e);
    }
  }, [setMessages]);

  const handleFollowUp = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setMessages((prev) => [...prev, { role: "user", content: message, timestamp: Date.now() } as AgentMessage]);
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "follow_up",
        message,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to follow up:", e);
    }
  }, [setMessages]);

  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort_compaction" });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
    }
  }, []);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    setThinkingLevel(level);
    if (level === "auto") return; // "auto" leaves pi's current setting untouched
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
    }
  }, []);

  const handleToolPresetChange = useCallback(async (preset: "none" | "default" | "full") => {
    const { PRESET_NONE, PRESET_DEFAULT, PRESET_FULL } = await import("@/components/ToolPanel");
    const toolNames = preset === "none" ? PRESET_NONE : preset === "default" ? PRESET_DEFAULT : PRESET_FULL;
    setToolPresetState(preset);
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_tools", toolNames });
    } catch (e) {
      console.error("Failed to set tools:", e);
    }
  }, [setToolPresetState]);

  // Load session on mount AND on session change.
  //
  // On session change, reset all session-scoped state to avoid bleed
  // from a previous session. AppShell's sessionKey remount is kept
  // as defense-in-depth (covers state in sub-hooks like
  // useChatScroll / useAgentEvents that we can't reset from here).
  //
  // The cancelled flag is a closure guard: when session A→B, the
  // effect's cleanup runs before the next effect call. Cleanup
  // sets cancelled=true on the OLD closure; the OLD .then (still
  // in flight) sees the flag and bails. Makes the effect
  // self-sufficient even if AppShell's remount is later removed.
  useEffect(() => {
    if (!session) return;
    const sid = session.id;
    sessionIdRef.current = sid;
    let cancelled = false;

    // Reset session-scoped state. Roughly follows useState
    // declaration order above for legibility; the exact order
    // has no functional impact since React batches these and
    // none depend on each other.
    setData(null);
    setActiveLeafId(null);
    setMessages([]);
    setEntryIds([]);
    setToolPreset("default");
    setThinkingLevel("auto");
    setAgentRunning(false);
    setAgentPhase(null);
    dispatch({ type: "reset" });   // streamState → {isStreaming:false, streamingMessage:null}
    setRetryInfo(null);
    setContextUsage(null);
    setSystemPrompt(null);
    setForkingEntryId(null);
    setIsCompacting(false);
    setCompactError(null);
    setCurrentModelOverride(null);
    setPendingModel(null);

    loadSessionFromApi(sid, true, true).then((loaded) => {
      if (cancelled) return;  // ignore stale results from a previous session
      const agentState = loaded?.agentState ?? null;
      if (!agentState?.state?.thinkingLevel && loaded?.contextThinkingLevel && loaded.contextThinkingLevel !== "off") {
        setThinkingLevel(loaded.contextThinkingLevel as ThinkingLevelOption);
      }
      if (agentState?.running) {
        loadTools(sid);
        if (agentState.state?.isStreaming) {
          setAgentRunning(true);
          setAgentPhase({ kind: "waiting_model" });
          connectEvents(sid);
        }
      }
      if (agentState?.state) {
        if (agentState.state.isCompacting !== undefined) setIsCompacting(agentState.state.isCompacting);
        if (agentState.state.contextUsage !== undefined) setContextUsage(agentState.state.contextUsage ?? null);
        if (agentState.state.systemPrompt !== undefined) setSystemPrompt(agentState.state.systemPrompt ?? null);
        if (agentState.state.thinkingLevel !== undefined) setThinkingLevel((agentState.state.thinkingLevel as ThinkingLevelOption) ?? "auto");
      }
    });

    return () => { cancelled = true; };
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
    onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChange);
  }, [data?.tree, activeLeafId, handleLeafChange, onBranchDataChange]);

  // Load model list
  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then((d: { models: Record<string, string>; modelList?: { id: string; name: string; provider: string }[]; defaultModel?: { provider: string; modelId: string } | null; thinkingLevels?: Record<string, string[]>; thinkingLevelMaps?: Record<string, Record<string, string | null>> }) => {
      setModelNames(d.models);
      if (d.thinkingLevels) setModelThinkingLevels(d.thinkingLevels);
      if (d.thinkingLevelMaps) setModelThinkingLevelMaps(d.thinkingLevelMaps);
      if (d.modelList) {
        setModelList(d.modelList);
        if (isNew && d.modelList.length > 0) {
          const def = d.defaultModel;
          const match = def && d.modelList.find((m) => m.id === def.modelId && m.provider === def.provider);
          const selected = match
            ? { provider: match.provider, modelId: match.id }
            : { provider: d.modelList[0].provider, modelId: d.modelList[0].id };
          setNewSessionModel(selected);
        }
      }
    }).catch((err) => { console.error("Failed to load model list:", err); });
  }, [isNew, modelsRefreshKey, setNewSessionModel]);

  // Compact error auto-dismiss
  useEffect(() => {
    if (!compactError) return;
    const t = setTimeout(() => setCompactError(null), 3000);
    return () => clearTimeout(t);
  }, [compactError]);

  return {
    // State
    data, loading, error, activeLeafId, messages, entryIds, streamState,
    agentRunning, modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, newSessionModel, toolPreset, thinkingLevel,
    retryInfo, contextUsage, systemPrompt, forkingEntryId,
    isCompacting, compactError, currentModel, displayModel, sessionStats,
    agentPhase,
    isNew,
    // Refs
    sessionIdRef, eventSourceRef, messagesEndRef, scrollContainerRef,
    lastUserMsgRef, pendingScrollToUserRef, initialScrollDoneRef,
    // Actions
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handleAbortCompaction,
    handleToolPresetChange, handleThinkingLevelChange, loadTools, setActiveLeafId, setData, setMessages,
    dispatch, setAgentRunning, setForkingEntryId, connectEvents,
    // Subscriptions
    handleAgentEventRef,
  };
}
