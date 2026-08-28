"use client";

import { useCallback, useRef, useState } from "react";
import type { AgentMessage, SessionTreeNode } from "../../lib/types";
import type { FollowUpQueueSnapshot } from "../../lib/follow-up-queue";
import { fetchSession, fetchContext } from "./session-loader-api.ts";

/** Latest-request-wins guard: stale() goes true once a newer call bumps the ref. */
export function latestRequestStale(ref: { current: number }): () => boolean {
  const reqId = ++ref.current;
  return () => reqId !== ref.current;
}

export interface SessionData {
  sessionId: string;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

export interface LoadedAgentState {
  running: boolean;
  state?: {
    isStreaming?: boolean;
    isCompacting?: boolean;
    contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
    systemPrompt?: string;
    thinkingLevel?: string;
    followUpQueue?: FollowUpQueueSnapshot;
  };
}

export interface LoadedSessionState {
  agentState: LoadedAgentState | null;
  contextThinkingLevel?: string;
}

export function useSessionLoader(isNew: boolean) {
  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);

  // Latest-request-wins guard (M3): when sessions switch quickly, a stale
  // response must not overwrite newer state. The caller's `cancelled` flag
  // only guards its outer .then, not these setState calls.
  const loadReqIdRef = useRef(0);
  const loadContextReqIdRef = useRef(0);

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false): Promise<LoadedSessionState | null> => {
    const stale = latestRequestStale(loadReqIdRef);
    try {
      if (showLoading) setLoading(true);
      const d = await fetchSession(sid, includeState) as SessionData & { agentState?: LoadedAgentState } | null;
      if (stale()) return null;
      if (d === null) {
        if (showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setError(null);
        }
        return null;
      }
      setData(d);
      setActiveLeafId(d.leafId);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setError(null);
      return { agentState: d.agentState ?? null, contextThinkingLevel: d.context.thinkingLevel };
    } catch (e) {
      if (stale()) return null;
      setError(String(e));
      return null;
    } finally {
      // Reset loading when the latest request settles (stale showLoading
      // requests may be superseded by a later showLoading=false request that
      // never set loading true — skipping the reset here would wedge it).
      if (!stale()) setLoading(false);
    }
  }, []);

  const loadContext = useCallback(async (sid: string, leafId: string | null) => {
    const stale = latestRequestStale(loadContextReqIdRef);
    try {
      const d = await fetchContext(sid, leafId);
      if (stale()) return;
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
    } catch (e) {
      if (stale()) return;
      console.error("Failed to load context:", e);
    }
  }, []);

  return {
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
    loadSession,
    loadContext,
  };
}
