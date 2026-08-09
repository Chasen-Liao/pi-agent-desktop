/**
 * Pure SSE agent-event → state patches + side-effect descriptors.
 * Keeps event contract testable without React or network.
 */
import type { AgentMessage, CustomMessage } from "../../lib/types.ts";
import { normalizeToolCalls } from "../../lib/normalize.ts";
import { addRunningTool, removeRunningTool, type AgentPhase } from "./agent-phase.ts";
import type { StreamAction } from "./stream-state.ts";
import type { AgentEvent } from "./agent-events-manager.ts";

export type RetryInfo = {
  attempt: number;
  maxAttempts: number;
  errorMessage?: string;
};

export type ContextUsage = {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
};

export type AgentEventSideEffect =
  | { type: "onAgentEndEvent" }
  | { type: "onAgentEnd" }
  | { type: "reloadSession" }
  | { type: "fetchAgentState" }
  | { type: "consoleError"; message: string }
  | { type: "extensionUiRequest"; request: import("./agent-events-manager").ExtensionUiRequestEvent }
  | { type: "extensionUiNotify"; message: string; notifyType: "info" | "warning" | "error" };

export type AgentPhaseOp =
  | { type: "set"; phase: AgentPhase }
  | { type: "addTool"; id: string; name: string }
  | { type: "removeTool"; id: string }
  | { type: "clear" };

export type AgentEventApplyResult = {
  agentRunning?: boolean;
  phaseOp?: AgentPhaseOp;
  streamAction?: StreamAction;
  retryInfo?: RetryInfo | null;
  isCompacting?: boolean;
  compactError?: string | null;
  /** Messages to append to the transcript (after normalization where applicable). */
  appendMessages?: AgentMessage[];
  effects: AgentEventSideEffect[];
};

export type ApplyAgentEventOptions = {
  /** Injected clock for deterministic agent_error timestamps in tests. */
  now?: number;
};

/**
 * Map one server SSE event into UI state patches and deferred side effects.
 * Side effects are descriptors only — the caller performs I/O.
 */
export function applyAgentEvent(
  event: AgentEvent,
  options: ApplyAgentEventOptions = {}
): AgentEventApplyResult {
  const now = options.now ?? Date.now();
  const effects: AgentEventSideEffect[] = [];

  switch (event.type) {
    case "agent_start":
      return {
        agentRunning: true,
        phaseOp: { type: "set", phase: { kind: "waiting_model" } },
        streamAction: { type: "start" },
        effects,
      };

    case "agent_end":
      effects.push({ type: "onAgentEndEvent" });
      effects.push({ type: "reloadSession" });
      effects.push({ type: "fetchAgentState" });
      effects.push({ type: "onAgentEnd" });
      return {
        agentRunning: false,
        phaseOp: { type: "set", phase: null },
        retryInfo: null,
        streamAction: { type: "end" },
        effects,
      };

    case "agent_error": {
      const msg = event.errorMessage || "Agent error";
      effects.push({ type: "consoleError", message: msg });
      const errorMessage: CustomMessage = {
        role: "custom",
        customType: "agent_error",
        content: msg,
        display: true,
        timestamp: now,
      };
      return {
        agentRunning: false,
        phaseOp: { type: "set", phase: null },
        retryInfo: null,
        streamAction: { type: "end" },
        appendMessages: [errorMessage as AgentMessage],
        effects,
      };
    }

    case "message_start":
    case "message_update": {
      const { message: msg } = event;
      const result: AgentEventApplyResult = {
        // Clear the current phase (e.g. waiting_model) but keep an active
        // running_tools phase — a streaming update that carries tool-call
        // content must not wipe the tool indicator. "clear" is resolved by
        // applyPhaseOp against the current phase.
        phaseOp: { type: "clear" },
        effects,
      };
      if (msg) {
        result.streamAction = {
          type: "update",
          message: normalizeToolCalls(msg as AgentMessage),
        };
      }
      return result;
    }

    case "message_end": {
      const { message: completed } = event;
      const result: AgentEventApplyResult = {
        streamAction: { type: "reset" },
        phaseOp: { type: "set", phase: { kind: "waiting_model" } },
        effects,
      };
      if (completed) {
        result.appendMessages = [normalizeToolCalls(completed)];
      }
      return result;
    }

    case "tool_execution_start":
      return {
        phaseOp: {
          type: "addTool",
          id: event.toolCallId,
          name: event.toolName,
        },
        effects,
      };

    case "tool_execution_end":
      return {
        phaseOp: { type: "removeTool", id: event.toolCallId },
        effects,
      };

    case "auto_retry_start":
      return {
        retryInfo: {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          errorMessage: event.errorMessage,
        },
        effects,
      };

    case "auto_retry_end":
      return { retryInfo: null, effects };

    case "auto_compaction_start":
    case "compaction_start":
      return {
        isCompacting: true,
        compactError: null,
        effects,
      };

    case "auto_compaction_end":
    case "compaction_end": {
      const result: AgentEventApplyResult = {
        isCompacting: false,
        effects,
      };
      if (event.errorMessage) {
        result.compactError = event.errorMessage;
      } else if (!event.aborted) {
        effects.push({ type: "reloadSession" });
      }
      return result;
    }

    case "extension_ui_request":
      effects.push({ type: "extensionUiRequest", request: event });
      return { effects };

    case "extension_ui_notify":
      effects.push({
        type: "extensionUiNotify",
        message: event.message,
        notifyType: event.notifyType ?? "info",
      });
      return { effects };

    default:
      // Connected / unknown variants: no-op (connected is handled by EventSource layer).
      return { effects };
  }
}

/** Apply a phase op to current phase (pure). */
export function applyPhaseOp(phase: AgentPhase, op: AgentPhaseOp): AgentPhase {
  if (op.type === "set") return op.phase;
  if (op.type === "addTool") return addRunningTool(phase, op.id, op.name);
  if (op.type === "removeTool") return removeRunningTool(phase, op.id);
  // "clear": null out the phase unless tools are actively running — a
  // streaming message update must not wipe the running_tools indicator.
  return phase?.kind === "running_tools" ? phase : null;
}
