import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAgentEvent,
  applyPhaseOp,
  type AgentEventApplyResult,
} from "./agent-event-apply.ts";
import type { AgentEvent } from "./agent-events-manager.ts";
import { streamReducer, initialStreamingState } from "./stream-state.ts";
import type { AgentPhase } from "./agent-phase.ts";

/** Reduce a sequence of events through pure apply + streamReducer (contract driver). */
function reduceEvents(events: AgentEvent[], now = 1_700_000_000_000) {
  let stream = initialStreamingState;
  let agentRunning = false;
  let phase: AgentPhase = null;
  let retryInfo: AgentEventApplyResult["retryInfo"] = null;
  let isCompacting = false;
  let compactError: string | null = null;
  const messages: unknown[] = [];
  const allEffects: AgentEventApplyResult["effects"] = [];

  for (const event of events) {
    const r = applyAgentEvent(event, { now });
    if (r.agentRunning !== undefined) agentRunning = r.agentRunning;
    if (r.phaseOp) phase = applyPhaseOp(phase, r.phaseOp);
    if (r.streamAction) stream = streamReducer(stream, r.streamAction);
    if (r.retryInfo !== undefined) retryInfo = r.retryInfo;
    if (r.isCompacting !== undefined) isCompacting = r.isCompacting;
    if (r.compactError !== undefined) compactError = r.compactError;
    if (r.appendMessages) messages.push(...r.appendMessages);
    allEffects.push(...r.effects);
  }

  return { stream, agentRunning, phase, retryInfo, isCompacting, compactError, messages, allEffects };
}

test("contract: agent_start → message_update → message_end → agent_end ends cleanly", () => {
  const assistant = {
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "hi" }],
    model: "m",
    provider: "p",
  };
  const { stream, agentRunning, phase, messages, allEffects } = reduceEvents([
    { type: "agent_start" },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "h" }] } },
    { type: "message_end", message: assistant },
    { type: "agent_end" },
  ]);

  assert.equal(agentRunning, false);
  assert.equal(stream.isStreaming, false);
  assert.equal(stream.streamingMessage, null);
  assert.equal(phase, null);
  assert.equal(messages.length, 1);
  assert.equal((messages[0] as { role: string }).role, "assistant");
  assert.ok(allEffects.some((e) => e.type === "reloadSession"));
  assert.ok(allEffects.some((e) => e.type === "fetchAgentState"));
  assert.ok(allEffects.some((e) => e.type === "onAgentEnd"));
  assert.ok(allEffects.some((e) => e.type === "onAgentEndEvent"));
});

test("contract: agent_error clears running state and surfaces transcript error", () => {
  const { stream, agentRunning, phase, messages, allEffects } = reduceEvents([
    { type: "agent_start" },
    { type: "agent_error", errorMessage: "provider boom" },
  ]);

  assert.equal(agentRunning, false);
  assert.equal(stream.isStreaming, false);
  assert.equal(phase, null);
  assert.equal(messages.length, 1);
  const err = messages[0] as { role: string; customType?: string; content: string; display?: boolean; timestamp?: number };
  assert.equal(err.role, "custom");
  assert.equal(err.customType, "agent_error");
  assert.equal(err.content, "provider boom");
  assert.equal(err.display, true);
  assert.equal(err.timestamp, 1_700_000_000_000);
  assert.ok(allEffects.some((e) => e.type === "consoleError" && e.message === "provider boom"));
  // Must NOT leave UI waiting for agent_end
  assert.ok(!allEffects.some((e) => e.type === "onAgentEnd"));
});

test("contract: tool_execution_start/end drives running_tools phase", () => {
  const { phase, agentRunning } = reduceEvents([
    { type: "agent_start" },
    { type: "tool_execution_start", toolCallId: "t1", toolName: "bash" },
    { type: "tool_execution_start", toolCallId: "t2", toolName: "read" },
    { type: "tool_execution_end", toolCallId: "t1" },
  ]);

  assert.equal(agentRunning, true);
  assert.deepEqual(phase, {
    kind: "running_tools",
    tools: [{ id: "t2", name: "read" }],
  });
});

test("contract: last tool_execution_end returns to waiting_model", () => {
  const { phase } = reduceEvents([
    { type: "agent_start" },
    { type: "tool_execution_start", toolCallId: "t1", toolName: "bash" },
    { type: "tool_execution_end", toolCallId: "t1" },
  ]);
  assert.deepEqual(phase, { kind: "waiting_model" });
});

test("contract: message_update keeps an active running_tools phase", () => {
  // Streaming message_update carries tool-call content while tools are
  // executing; it must NOT null out the running_tools phase. Only an explicit
  // tool_execution_end / agent_end may clear it.
  const { phase } = reduceEvents([
    { type: "agent_start" },
    { type: "tool_execution_start", toolCallId: "t1", toolName: "bash" },
    { type: "message_update", message: { role: "assistant", content: [] } },
    { type: "message_update", message: { role: "assistant", content: [] } },
  ]);
  assert.deepEqual(phase, { kind: "running_tools", tools: [{ id: "t1", name: "bash" }] });
});

test("contract: message_update still clears a waiting_model phase", () => {
  // Without tools running, message_start/update should keep clearing the
  // waiting_model phase (the no-spinner state while text streams).
  const { phase } = reduceEvents([
    { type: "agent_start" },
    { type: "message_update", message: { role: "assistant", content: [] } },
  ]);
  assert.equal(phase, null);
});

test("contract: auto_retry and compaction lifecycle", () => {
  const mid = reduceEvents([
    { type: "agent_start" },
    { type: "auto_retry_start", attempt: 1, maxAttempts: 3, errorMessage: "rate limit" },
  ]);
  assert.deepEqual(mid.retryInfo, {
    attempt: 1,
    maxAttempts: 3,
    errorMessage: "rate limit",
  });

  const afterRetryEnd = reduceEvents([
    { type: "agent_start" },
    { type: "auto_retry_start", attempt: 1, maxAttempts: 3 },
    { type: "auto_retry_end" },
  ]);
  assert.equal(afterRetryEnd.retryInfo, null);

  const compactOk = reduceEvents([
    { type: "compaction_start" },
    { type: "compaction_end" },
  ]);
  assert.equal(compactOk.isCompacting, false);
  assert.ok(compactOk.allEffects.some((e) => e.type === "reloadSession"));

  const compactErr = reduceEvents([
    { type: "auto_compaction_start" },
    { type: "auto_compaction_end", errorMessage: "too short" },
  ]);
  assert.equal(compactErr.isCompacting, false);
  assert.equal(compactErr.compactError, "too short");
  assert.ok(!compactErr.allEffects.some((e) => e.type === "reloadSession"));

  const compactAborted = reduceEvents([
    { type: "compaction_start" },
    { type: "compaction_end", aborted: true },
  ]);
  assert.ok(!compactAborted.allEffects.some((e) => e.type === "reloadSession"));
});

test("contract: message_update normalizes legacy toolCall id/name/arguments fields", () => {
  const r = applyAgentEvent({
    type: "message_update",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "legacy-id",
          name: "bash",
          arguments: { cmd: "ls" },
        } as unknown as never,
      ],
      model: "m",
      provider: "p",
    } as never,
  });

  assert.ok(r.streamAction?.type === "update");
  if (r.streamAction?.type !== "update") return;
  const content = r.streamAction.message.content as unknown as Array<{
    toolCallId?: string;
    toolName?: string;
    input?: Record<string, unknown>;
  }>;
  assert.equal(content[0].toolCallId, "legacy-id");
  assert.equal(content[0].toolName, "bash");
  assert.deepEqual(content[0].input, { cmd: "ls" });
});

test("contract: extension_ui_request and notify produce side effects", () => {
  const r1 = applyAgentEvent({
    type: "extension_ui_request",
    id: "u1",
    method: "confirm",
    title: "Allow?",
    message: "bash ls",
  });
  assert.equal(r1.effects[0]?.type, "extensionUiRequest");
  if (r1.effects[0]?.type === "extensionUiRequest") {
    assert.equal(r1.effects[0].request.id, "u1");
  }

  const r2 = applyAgentEvent({
    type: "extension_ui_notify",
    message: "hi",
    notifyType: "warning",
  });
  assert.equal(r2.effects[0]?.type, "extensionUiNotify");
  if (r2.effects[0]?.type === "extensionUiNotify") {
    assert.equal(r2.effects[0].message, "hi");
    assert.equal(r2.effects[0].notifyType, "warning");
  }
});

test("applyPhaseOp set/add/remove matches agent-phase helpers", () => {
  let phase: AgentPhase = null;
  phase = applyPhaseOp(phase, { type: "set", phase: { kind: "waiting_model" } });
  phase = applyPhaseOp(phase, { type: "addTool", id: "a", name: "bash" });
  assert.deepEqual(phase, { kind: "running_tools", tools: [{ id: "a", name: "bash" }] });
  phase = applyPhaseOp(phase, { type: "removeTool", id: "a" });
  assert.deepEqual(phase, { kind: "waiting_model" });
});
