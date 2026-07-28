import test from "node:test";
import assert from "node:assert/strict";
import {
  ASK_CONFIRM_TOOLS,
  PLAN_TOOLS,
  askBlockResult,
  effectiveToolsForMode,
  isAgentMode,
  needsAskConfirm,
  summarizeToolCall,
  toolNamesForPreset,
} from "./approval-policy.ts";

test("plan mode always returns the four read tools", () => {
  assert.deepEqual(effectiveToolsForMode("plan", "none"), [...PLAN_TOOLS]);
  assert.deepEqual(effectiveToolsForMode("plan", "default"), [...PLAN_TOOLS]);
  assert.deepEqual(effectiveToolsForMode("plan", "full"), [...PLAN_TOOLS]);
});

test("ask/full use tool preset lists", () => {
  assert.deepEqual(effectiveToolsForMode("ask", "none"), []);
  assert.deepEqual(effectiveToolsForMode("full", "default"), toolNamesForPreset("default"));
  assert.deepEqual(effectiveToolsForMode("ask", "full"), toolNamesForPreset("full"));
});

test("needsAskConfirm only for bash/write/edit in ask mode", () => {
  for (const t of ASK_CONFIRM_TOOLS) {
    assert.equal(needsAskConfirm("ask", t), true, t);
  }
  assert.equal(needsAskConfirm("ask", "read"), false);
  assert.equal(needsAskConfirm("ask", "grep"), false);
  assert.equal(needsAskConfirm("full", "bash"), false);
  assert.equal(needsAskConfirm("plan", "write"), false);
});

test("askBlockResult shape", () => {
  const r = askBlockResult();
  assert.equal(r.block, true);
  assert.match(r.reason, /Ask mode/);
});

test("summarizeToolCall prefers bash command and paths", () => {
  assert.match(summarizeToolCall("bash", { command: "ls -la" }), /ls -la/);
  assert.match(summarizeToolCall("write", { path: "a.ts" }), /a\.ts/);
  assert.match(summarizeToolCall("edit", { path: "b.ts" }), /b\.ts/);
});

test("isAgentMode", () => {
  assert.equal(isAgentMode("ask"), true);
  assert.equal(isAgentMode("nope"), false);
});
