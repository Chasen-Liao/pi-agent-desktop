"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentEventsManager, type AgentEvent, type ConnectionStatus } from "./agent-events-manager";

export type { AgentEvent, ConnectionStatus };

interface UseAgentEventsOptions {
  agentRunning: boolean;
}

export function useAgentEvents({ agentRunning }: UseAgentEventsOptions) {
  const managerRef = useRef<AgentEventsManager | null>(null);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");

  if (!managerRef.current) {
    managerRef.current = new AgentEventsManager();
  }

  useEffect(() => {
    managerRef.current?.setAgentRunning(agentRunning);
  }, [agentRunning]);

  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    manager.setEventHandler((event) => {
      handleAgentEventRef.current?.(event);
    });
    manager.setStatusChangeHandler(setConnectionStatus);
    return () => {
      manager.setStatusChangeHandler(null);
      manager.cleanup();
    };
  }, []);

  const connectEvents = useCallback((sid: string) => {
    // expectRunning=true: connect may fire before the [agentRunning] effect
    // reaches the manager (see handleSend ordering); express intent now so an
    // early SSE onerror reconnects instead of leaving the UI stuck on Waiting.
    managerRef.current?.connect(sid, true, true);
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
    connectionStatus,
  };
}
