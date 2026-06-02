import test from "node:test";
import assert from "node:assert/strict";
import { normalizeToolCalls } from "./normalize.ts";
import type { AgentMessage, AssistantContentBlock, AssistantMessage } from "./types.ts";

const userMsg: AgentMessage = {
  role: "user",
  content: "hi",
  timestamp: 1,
};

const toolResultMsg: AgentMessage = {
  role: "toolResult",
  toolCallId: "tc-1",
  content: [{ type: "text", text: "ok" }],
};

const customMsg: AgentMessage = {
  role: "custom",
  customType: "x",
  content: "y",
  display: true,
};

const baseAssistant = (content: AssistantContentBlock[]): AssistantMessage => ({
  role: "assistant",
  content,
  model: "m",
  provider: "p",
  stopReason: "stop",
  timestamp: 2,
});

test("returns user message unchanged", () => {
  assert.equal(normalizeToolCalls(userMsg), userMsg);
});

test("returns toolResult message unchanged", () => {
  assert.equal(normalizeToolCalls(toolResultMsg), toolResultMsg);
});

test("returns custom message unchanged", () => {
  assert.equal(normalizeToolCalls(customMsg), customMsg);
});

test("returns assistant with non-array content unchanged", () => {
  // Defensive: if a future code path feeds a malformed assistant message,
  // the function should pass it through rather than crash.
  const weird = { role: "assistant", content: "not-an-array" } as unknown as AgentMessage;
  assert.equal(normalizeToolCalls(weird), weird);
});

test("normalizes toolCall block: prefers toolCallId over id", () => {
  // Intentionally include both `toolCallId` and `id` to verify `toolCallId` wins.
  const block = { type: "toolCall", toolCallId: "real", id: "fallback", toolName: "bash", input: { cmd: "ls" } } as unknown as AssistantContentBlock;
  const msg = baseAssistant([block]);
  const out = normalizeToolCalls(msg) as AssistantMessage;
  assert.equal(out.content[0].type, "toolCall");
  const tc = out.content[0] as { toolCallId: string; toolName: string; input: Record<string, unknown> };
  assert.equal(tc.toolCallId, "real");
  assert.equal(tc.toolName, "bash");
  assert.deepEqual(tc.input, { cmd: "ls" });
});

test("normalizes toolCall block: falls back to id when toolCallId missing", () => {
  // Construct in the OLD pi shape (id/name/arguments) to exercise normalization.
  const block = { type: "toolCall", id: "legacy-id", name: "grep", arguments: { pattern: "x" } } as unknown as AssistantContentBlock;
  const msg = baseAssistant([block]);
  const out = normalizeToolCalls(msg) as AssistantMessage;
  const tc = out.content[0] as { toolCallId: string; toolName: string; input: Record<string, unknown> };
  assert.equal(tc.toolCallId, "legacy-id");
  assert.equal(tc.toolName, "grep");
  assert.deepEqual(tc.input, { pattern: "x" });
});

test("normalizes toolCall block: empty strings for missing id and name", () => {
  const msg = baseAssistant([
    { type: "toolCall" } as never,
  ]);
  const out = normalizeToolCalls(msg) as AssistantMessage;
  const tc = out.content[0] as { toolCallId: string; toolName: string; input: Record<string, unknown> };
  assert.equal(tc.toolCallId, "");
  assert.equal(tc.toolName, "");
  assert.deepEqual(tc.input, {});
});

test("passes through text block unchanged", () => {
  const block: AssistantContentBlock = { type: "text", text: "hello" };
  const msg = baseAssistant([block]);
  const out = normalizeToolCalls(msg) as AssistantMessage;
  assert.equal(out.content[0], block);
});

test("passes through thinking block unchanged", () => {
  const block: AssistantContentBlock = { type: "thinking", thinking: "hmm" };
  const msg = baseAssistant([block]);
  const out = normalizeToolCalls(msg) as AssistantMessage;
  assert.equal(out.content[0], block);
});

test("passes through image block unchanged", () => {
  const block: AssistantContentBlock = { type: "image", source: { type: "base64", data: "x" } };
  const msg = baseAssistant([block]);
  const out = normalizeToolCalls(msg) as AssistantMessage;
  assert.equal(out.content[0], block);
});

test("mixed content: toolCalls normalized, others unchanged", () => {
  const textBlock: AssistantContentBlock = { type: "text", text: "before" };
  // Intentionally construct a toolCall block in the OLD pi shape (id/name/arguments)
  // to exercise the normalization path.
  const toolBlock = { type: "toolCall", id: "tc", name: "bash", arguments: { x: 1 } } as unknown as AssistantContentBlock;
  const thinkingBlock: AssistantContentBlock = { type: "thinking", thinking: "t" };
  const msg = baseAssistant([textBlock, toolBlock, thinkingBlock]);
  const out = normalizeToolCalls(msg) as AssistantMessage;
  assert.equal(out.content[0], textBlock);
  assert.equal((out.content[1] as { type: string }).type, "toolCall");
  const tc = out.content[1] as { toolCallId: string; toolName: string; input: Record<string, unknown> };
  assert.equal(tc.toolCallId, "tc");
  assert.equal(tc.toolName, "bash");
  assert.deepEqual(tc.input, { x: 1 });
  assert.equal(out.content[2], thinkingBlock);
});

test("preserves other assistant fields (model, provider, stopReason, timestamp)", () => {
  const msg = baseAssistant([{ type: "text", text: "x" }]);
  const out = normalizeToolCalls(msg) as AssistantMessage;
  assert.equal(out.model, "m");
  assert.equal(out.provider, "p");
  assert.equal(out.stopReason, "stop");
  assert.equal(out.timestamp, 2);
});

test("block with no recognizable fields is passed through unchanged", () => {
  const block = { somethingElse: true };
  const msg = baseAssistant([block as never]);
  const out = normalizeToolCalls(msg) as AssistantMessage;
  assert.equal(out.content[0], block);
});
