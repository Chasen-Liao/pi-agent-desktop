/**
 * Structural + functional surface checks for Wave 1 agent mode / UI bridge commands.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import { AGENT_COMMAND_TYPES, validateAgentCommand } from "./agent-commands.ts";
import {
  ASK_CONFIRM_TOOLS,
  EXECUTE_PLAN_PROMPT,
  effectiveToolsForMode,
  needsAskConfirm,
} from "./approval-policy.ts";
import { AgentSessionWrapper } from "./rpc-manager.ts";
import { ExtensionUiBridge } from "./extension-ui-bridge.ts";

const root = process.cwd();

test("command whitelist accepts set_agent_mode and extension_ui_response", () => {
  assert.ok(AGENT_COMMAND_TYPES.has("set_agent_mode"));
  assert.ok(AGENT_COMMAND_TYPES.has("extension_ui_response"));
  assert.equal(validateAgentCommand({ type: "set_agent_mode", mode: "ask" }), null);
  assert.equal(
    validateAgentCommand({ type: "extension_ui_response", id: "x", confirmed: true }),
    null
  );
});

test("plan/ask/full tool policy is shipped", () => {
  assert.deepEqual(effectiveToolsForMode("plan", "full").sort(), ["find", "grep", "ls", "read"]);
  for (const t of ASK_CONFIRM_TOOLS) assert.equal(needsAskConfirm("ask", t), true);
  assert.equal(needsAskConfirm("full", "bash"), false);
  assert.match(EXECUTE_PLAN_PROMPT, /计划/);
});

test("wrapper set_agent_mode + extension_ui_response path", async () => {
  const tools: string[][] = [];
  const inner = {
    sessionId: "s",
    sessionFile: "s.jsonl",
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: false,
    autoRetryEnabled: false,
    model: null,
    getContextUsage: () => null,
    agent: { state: { systemPrompt: "", thinkingLevel: "off" } },
    sessionManager: null,
    modelRuntime: { getModel: () => undefined },
    prompt: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    setModel: () => Promise.resolve(),
    navigateTree: () => Promise.resolve({ cancelled: false }),
    setThinkingLevel: () => {},
    compact: () => Promise.resolve(null),
    setAutoCompactionEnabled: () => {},
    setAutoRetryEnabled: () => {},
    steer: () => Promise.resolve(),
    followUp: () => Promise.resolve(),
    getAllTools: () => [],
    getActiveToolNames: () => [],
    setActiveToolsByName: (n: string[]) => {
      tools.push([...n]);
    },
    abortCompaction: () => {},
    subscribe: () => () => {},
  };
  const w = new AgentSessionWrapper(inner as never);
  w.initPolicy("ask", "default");
  await w.send({ type: "set_agent_mode", mode: "plan" });
  assert.ok(tools.some((t) => t.includes("read") && !t.includes("bash")));

  const bridge = new ExtensionUiBridge(() => {});
  w.attachUiBridge(bridge);
  // no pending — should throw
  await assert.rejects(
    w.send({ type: "extension_ui_response", id: "missing", confirmed: true }),
    /Unknown/
  );
});

test("UI entry points exist in source", () => {
  const files = [
    "components/AgentModeSelector.tsx",
    "components/ExtensionUiDialog.tsx",
    "components/ProjectTrustDialog.tsx",
    "components/ExecutePlanBar.tsx",
    "components/ChatWindow.tsx",
    "components/ChatInput.tsx",
    "app/api/trust/route.ts",
    "app/api/desktop-settings/route.ts",
  ];
  for (const f of files) {
    const src = readFileSync(join(root, f), "utf8");
    assert.ok(src.length > 50, f);
  }
  const chat = readFileSync(join(root, "components/ChatWindow.tsx"), "utf8");
  assert.match(chat, /AgentModeSelector|onAgentModeChange/);
  assert.match(chat, /ExtensionUiDialog/);
  assert.match(chat, /ProjectTrustDialog/);
  assert.match(chat, /ExecutePlanBar/);
  assert.match(chat, /执行此计划|handleExecutePlan/);
});
