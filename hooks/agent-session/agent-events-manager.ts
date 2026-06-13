export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

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
