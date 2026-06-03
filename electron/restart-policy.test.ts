import test from "node:test";
import assert from "node:assert/strict";
import { getNextRestartState } from "./restart-policy.ts";

test("getNextRestartState allows three ready-state restarts inside the window", () => {
  assert.deepEqual(getNextRestartState({ now: 1_000, attempts: [], serverState: "ready", isQuitting: false }), {
    shouldRestart: true,
    attempts: [1_000],
  });
  assert.deepEqual(getNextRestartState({ now: 1_500, attempts: [1_000, 1_250], serverState: "ready", isQuitting: false }), {
    shouldRestart: true,
    attempts: [1_000, 1_250, 1_500],
  });
  assert.deepEqual(getNextRestartState({ now: 2_000, attempts: [1_000, 1_500, 1_750], serverState: "ready", isQuitting: false }), {
    shouldRestart: false,
    attempts: [1_000, 1_500, 1_750],
  });
});

test("getNextRestartState does not restart during startup, stopped, or quit", () => {
  assert.equal(getNextRestartState({ now: 1_000, attempts: [], serverState: "starting", isQuitting: false }).shouldRestart, false);
  assert.equal(getNextRestartState({ now: 1_000, attempts: [], serverState: "stopped", isQuitting: false }).shouldRestart, false);
  assert.equal(getNextRestartState({ now: 1_000, attempts: [], serverState: "ready", isQuitting: true }).shouldRestart, false);
});
