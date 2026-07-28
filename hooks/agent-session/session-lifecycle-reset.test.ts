import test from "node:test";
import assert from "node:assert/strict";
import {
  sessionScopedResetPatch,
  loadedAgentStatePatch,
} from "./session-lifecycle-reset.ts";

test("sessionScopedResetPatch clears session-scoped fields to safe defaults", () => {
  const p = sessionScopedResetPatch();
  assert.equal(p.toolPreset, "default");
  assert.equal(p.thinkingLevel, "auto");
  assert.equal(p.agentRunning, false);
  assert.equal(p.agentPhase, null);
  assert.equal(p.streamReset, true);
  assert.equal(p.clearMessages, true);
  assert.equal(p.currentModelOverride, null);
  assert.equal(p.pendingModel, null);
});

test("loadedAgentStatePatch reconnects when agent still streaming", () => {
  const p = loadedAgentStatePatch({
    agentState: {
      running: true,
      state: {
        isStreaming: true,
        isCompacting: false,
        systemPrompt: "sys",
        thinkingLevel: "high",
        contextUsage: { percent: 10, contextWindow: 1000, tokens: 100 },
      },
    },
  });
  assert.equal(p.agentRunning, true);
  assert.equal(p.agentPhaseWaitingModel, true);
  assert.equal(p.connectEvents, true);
  assert.equal(p.loadTools, true);
  assert.equal(p.thinkingLevel, "high");
  assert.equal(p.systemPrompt, "sys");
  assert.deepEqual(p.contextUsage, { percent: 10, contextWindow: 1000, tokens: 100 });
});

test("loadedAgentStatePatch uses context thinking when live state omits it", () => {
  const p = loadedAgentStatePatch({
    agentState: { running: false, state: {} },
    contextThinkingLevel: "medium",
  });
  assert.equal(p.thinkingLevel, "medium");
  assert.equal(p.connectEvents, undefined);
});

test("loadedAgentStatePatch ignores context thinking off", () => {
  const p = loadedAgentStatePatch({
    agentState: null,
    contextThinkingLevel: "off",
  });
  assert.equal(p.thinkingLevel, undefined);
});
