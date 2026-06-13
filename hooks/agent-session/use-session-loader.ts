"use client";

import { useCallback, useState } from "react";
import type { AgentMessage, SessionTreeNode } from "../../lib/types";
import { fetchSession, fetchContext } from "./session-loader-api";

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

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false): Promise<LoadedSessionState | null> => {
    try {
      if (showLoading) setLoading(true);
      const d = await fetchSession(sid, includeState) as SessionData & { agentState?: LoadedAgentState } | null;
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
      setError(String(e));
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const loadContext = useCallback(async (sid: string, leafId: string | null) => {
    try {
      const d = await fetchContext(sid, leafId);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
    } catch (e) {
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
