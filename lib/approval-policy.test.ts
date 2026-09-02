import test from "node:test";
import assert from "node:assert/strict";
import {
  ASK_CONFIRM_TOOLS,
  PLAN_TOOLS,
  askBlockResult,
  effectiveToolsForMode,
  extractCustomToolNames,
  isAgentMode,
  needsAskConfirm,
  summarizeToolCall,
  toolNamesForPreset,
} from "./approval-policy.ts";

test("plan mode always returns the four read tools", () => {
  assert.deepEqual(effectiveToolsForMode("plan", "none"), [...PLAN_TOOLS]);
  assert.deepEqual(effectiveToolsForMode("plan", "default"), [...PLAN_TOOLS]);
  assert.deepEqual(effectiveToolsForMode("plan", "full"), [...PLAN_TOOLS]);
  assert.deepEqual(effectiveToolsForMode("plan", "default", ["ffgrep", "web_search"]), [...PLAN_TOOLS]);
});

test("ask/full use tool preset lists and preserve custom tools", () => {
  assert.deepEqual(effectiveToolsForMode("ask", "none"), []);
  assert.deepEqual(effectiveToolsForMode("ask", "none", ["ffgrep"]), []);
  assert.deepEqual(effectiveToolsForMode("full", "default"), toolNamesForPreset("default"));
  assert.deepEqual(
    effectiveToolsForMode("full", "default", ["ffgrep", "subagent"]),
    ["read", "bash", "edit", "write", "ffgrep", "subagent"]
  );
  assert.deepEqual(effectiveToolsForMode("ask", "full"), toolNamesForPreset("full"));
  assert.deepEqual(
    effectiveToolsForMode("ask", "full", ["ffgrep"]),
    ["bash", "read", "edit", "write", "grep", "find", "ls", "ffgrep"]
  );
});

test("extractCustomToolNames filters builtins and memory tools", () => {
  const all = ["read", "bash", "edit", "write", "grep", "find", "ls", "memory_save", "memory_recall", "memory_forget", "ffgrep", "fffind", "tavily_search"];
  assert.deepEqual(extractCustomToolNames(all), ["ffgrep", "fffind", "tavily_search"]);
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

test("needsAskConfirm requires confirm for memory write tools in ask mode (S2)", () => {
  assert.equal(needsAskConfirm("ask", "memory_save"), true);
  assert.equal(needsAskConfirm("ask", "memory_forget"), true);
  assert.equal(needsAskConfirm("ask", "memory_recall"), false);
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
