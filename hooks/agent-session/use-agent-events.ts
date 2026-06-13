"use client";

import { useCallback, useEffect, useRef } from "react";
import { AgentEventsManager, type AgentEvent } from "./agent-events-manager";

export type { AgentEvent };

interface UseAgentEventsOptions {
  agentRunning: boolean;
}

export function useAgentEvents({ agentRunning }: UseAgentEventsOptions) {
  const managerRef = useRef<AgentEventsManager | null>(null);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);

  if (!managerRef.current) {
    managerRef.current = new AgentEventsManager();
  }

  useEffect(() => {
    managerRef.current?.setAgentRunning(agentRunning);
  }, [agentRunning]);

  useEffect(() => {
    if (managerRef.current) {
      managerRef.current.setEventHandler((event) => {
        handleAgentEventRef.current?.(event);
      });
    }
    return () => {
      managerRef.current?.cleanup();
    };
  }, []);

  const connectEvents = useCallback((sid: string) => {
    managerRef.current?.connect(sid);
  }, []);

  const eventSourceRef = {
    get current() {
      return managerRef.current?.getEventSource() ?? null;
    },
    set current(_val) {
      // no-op, managed internally
    }
  };

  const agentRunningRef = {
    get current() {
      return managerRef.current?.getAgentRunning() ?? false;
    },
    set current(val) {
      if (managerRef.current) {
        managerRef.current.setAgentRunning(val);
      }
    }
  };

  return {
    eventSourceRef,
    agentRunningRef,
    handleAgentEventRef,
    connectEvents,
  };
}
