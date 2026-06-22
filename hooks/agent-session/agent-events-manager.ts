import type { AgentMessage } from "@/lib/types";

/**
 * Events pushed from server to client via SSE. Each variant is discriminated
 * by `type`, so `switch (event.type)` narrows automatically — no `as` casts
 * needed at call sites.
 *
 * Note: the server-side `AgentEvent` in `lib/rpc-manager.ts` is intentionally
 * a separate, broader type — the server only forwards pi's events without
 * narrowing, and the two runtimes should not share a type.
 */
export type AgentEvent =
  | { type: "connected"; sessionId: string }
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "agent_error"; errorMessage: string }
  | { type: "message_start"; message: Partial<AgentMessage> }
  | { type: "message_update"; message: Partial<AgentMessage> }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string }
  | { type: "tool_execution_end"; toolCallId: string }
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number; errorMessage?: string }
  | { type: "auto_retry_end" }
  | { type: "auto_compaction_start" }
  | { type: "compaction_start" }
  | { type: "auto_compaction_end"; errorMessage?: string; aborted?: boolean }
  | { type: "compaction_end"; errorMessage?: string; aborted?: boolean };

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "failed";

export class AgentEventsManager {
  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private agentRunning = false;
  private handleAgentEvent: ((event: AgentEvent) => void) | null = null;
  private sid: string | null = null;
  private reconnectDelay: number;
  private reconnectAttempts = 0;
  private status: ConnectionStatus = "disconnected";

  constructor(reconnectDelay = 1000) {
    this.reconnectDelay = reconnectDelay;
  }

  private setStatus(newStatus: ConnectionStatus) {
    this.status = newStatus;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("pi-connection-status", { detail: newStatus }));
    }
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  setAgentRunning(running: boolean) {
    this.agentRunning = running;
    if (!running) {
      this.disconnect();
      this.setStatus("disconnected");
    }
  }

  getAgentRunning() {
    return this.agentRunning;
  }

  setEventHandler(handler: (event: AgentEvent) => void) {
    this.handleAgentEvent = handler;
  }

  getEventSource() {
    return this.eventSource;
  }

  connect(sid: string, resetAttempts = true) {
    this.sid = sid;
    if (resetAttempts) {
      this.reconnectAttempts = 0;
    }
    this.disconnect();
    this.setStatus("connecting");

    const es = new EventSource(`/api/agent/${encodeURIComponent(sid)}/events`);
    this.eventSource = es;

    es.onopen = () => {
      if (this.eventSource === es) {
        this.reconnectAttempts = 0;
        this.setStatus("connected");
      }
    };

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as AgentEvent;
        this.handleAgentEvent?.(event);
      } catch (err) {
        console.error("Failed to parse agent event", { data: e.data, error: err });
      }
    };

    es.onerror = () => {
      if (this.eventSource === es && this.agentRunning) {
        this.disconnect();
        this.reconnectAttempts++;
        if (this.reconnectAttempts > 5) {
          this.setStatus("failed");
          return;
        }

        this.setStatus("connecting");
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, up to 30s max
        const delay = Math.min(30000, this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1));
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          if (this.agentRunning && this.sid) {
            this.connect(this.sid, false);
          }
        }, delay);
      } else if (this.eventSource === es) {
        this.disconnect();
        this.setStatus("disconnected");
      }
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  cleanup() {
    this.disconnect();
    this.sid = null;
    this.handleAgentEvent = null;
    this.setStatus("disconnected");
  }
}
