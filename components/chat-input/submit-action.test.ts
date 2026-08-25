import assert from "node:assert/strict";
import test from "node:test";
import { resolveComposerSubmitAction } from "./submit-action.ts";

test("Enter steers the running agent", () => {
  assert.equal(resolveComposerSubmitAction({
    altKey: false,
    shiftKey: false,
    isComposing: false,
    isStreaming: true,
    slashMenuOpen: false,
    canSteer: true,
    canFollowUp: true,
  }), "steer");
});

test("Alt+Enter queues a follow-up while the agent is running", () => {
  assert.equal(resolveComposerSubmitAction({
    altKey: true,
    shiftKey: false,
    isComposing: false,
    isStreaming: true,
    slashMenuOpen: true,
    canSteer: true,
    canFollowUp: true,
  }), "followup");
});

test("Shift+Enter keeps the newline behavior", () => {
  assert.equal(resolveComposerSubmitAction({
    altKey: false,
    shiftKey: true,
    isComposing: false,
    isStreaming: true,
    slashMenuOpen: false,
    canSteer: true,
    canFollowUp: true,
  }), "none");
});

test("Enter selects a slash item when the slash menu is open", () => {
  assert.equal(resolveComposerSubmitAction({
    altKey: false,
    shiftKey: false,
    isComposing: false,
    isStreaming: true,
    slashMenuOpen: true,
    canSteer: true,
    canFollowUp: true,
  }), "slash");
});

test("Enter falls back to follow-up when steering is unavailable", () => {
  assert.equal(resolveComposerSubmitAction({
    altKey: false,
    shiftKey: false,
    isComposing: false,
    isStreaming: true,
    slashMenuOpen: false,
    canSteer: false,
    canFollowUp: true,
  }), "followup");
});
