"use client";

import { useCallback, useEffect, useRef } from "react";

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

interface UseAgentEventsOptions {
  agentRunning: boolean;
}

export function useAgentEvents({ agentRunning }: UseAgentEventsOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentRunningRef = useRef(false);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);

  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);

  const connectEvents = useCallback((sid: string) => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    const es = new EventSource(`/api/agent/${encodeURIComponent(sid)}/events`);
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as AgentEvent;
        handleAgentEventRef.current?.(event);
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      if (eventSourceRef.current === es && agentRunningRef.current) {
        es.close();
        eventSourceRef.current = null;
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (agentRunningRef.current) connectEvents(sid);
        }, 1000);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, []);

  return {
    eventSourceRef,
    agentRunningRef,
    handleAgentEventRef,
    connectEvents,
  };
}
