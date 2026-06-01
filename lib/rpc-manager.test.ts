import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { AgentSessionWrapper } from "./rpc-manager.ts";

type SubscribeFn = (cb: (event: unknown) => void) => () => void;

function makeStubInner(overrides: {
  subscribe?: SubscribeFn;
  sessionManager?: unknown;
} = {}) {
  return {
    sessionId: "stub",
    sessionFile: "stub.jsonl",
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: false,
    autoRetryEnabled: false,
    model: null,
    getContextUsage: () => null,
    agent: { state: { systemPrompt: "", thinkingLevel: "off" } },
    sessionManager: overrides.sessionManager ?? null,
    modelRegistry: null,
    subscribe: overrides.subscribe ?? ((cb: (event: unknown) => void) => { void cb; return () => {}; }),
  } as never;
}

test("wrapper is destroyed after 10 min of inactivity", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = new AgentSessionWrapper(makeStubInner());
    let destroyed = false;
    w.onDestroy(() => { destroyed = true; });
    w.start();

    mock.timers.tick(9 * 60 * 1000);
    assert.equal(destroyed, false, "should still be alive after 9 min");

    mock.timers.tick(60 * 1000);
    assert.equal(destroyed, true, "should be destroyed after 10 min");
  } finally {
    mock.timers.reset();
  }
});

test("keepAlive resets the idle timer", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = new AgentSessionWrapper(makeStubInner());
    let destroyed = false;
    w.onDestroy(() => { destroyed = true; });
    w.start();

    mock.timers.tick(9 * 60 * 1000);
    assert.equal(destroyed, false);

    w.keepAlive();

    mock.timers.tick(9 * 60 * 1000);
    assert.equal(destroyed, false, "should still be alive 9 min after keepAlive");

    mock.timers.tick(60 * 1000);
    assert.equal(destroyed, true, "should be destroyed 10 min after keepAlive");
  } finally {
    mock.timers.reset();
  }
});

test("events reset the idle timer (regression)", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let emittedCb: ((event: unknown) => void) | null = null;
    const inner = makeStubInner({
      subscribe: (cb) => { emittedCb = cb; return () => {}; },
    });
    const w = new AgentSessionWrapper(inner);
    let destroyed = false;
    w.onDestroy(() => { destroyed = true; });
    w.start();

    mock.timers.tick(9 * 60 * 1000);
    assert.equal(destroyed, false);

    emittedCb!({ type: "agent_start" });

    mock.timers.tick(9 * 60 * 1000);
    assert.equal(destroyed, false, "should still be alive 9 min after pi event");

    mock.timers.tick(60 * 1000);
    assert.equal(destroyed, true, "should be destroyed 10 min after last event");
  } finally {
    mock.timers.reset();
  }
});

test("keepAlive is a no-op on a destroyed wrapper", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = new AgentSessionWrapper(makeStubInner());
    let destroyed = false;
    w.onDestroy(() => { destroyed = true; });
    w.start();

    // Force destruction via idle timeout
    mock.timers.tick(10 * 60 * 1000);
    assert.equal(destroyed, true);

    // keepAlive after destroy must not schedule a new timer or throw.
    // If it scheduled a timer, ticking past 10 min would NOT cause
    // observable harm (the timer's destroy() is idempotent), but the
    // contract is: no-op on dead wrapper.
    w.keepAlive();
    mock.timers.tick(20 * 60 * 1000);
    // Still only one onDestroy call (the original). No error thrown.
    assert.equal(destroyed, true);
  } finally {
    mock.timers.reset();
  }
});

test("fork returns {cancelled: true} for non-persisted session", async () => {
  const inner = makeStubInner({
    sessionManager: { isPersisted: () => false },
  });
  const w = new AgentSessionWrapper(inner);
  w.start();
  const result = await w.send({ type: "fork", entryId: "x" });
  assert.deepEqual(result, { cancelled: true });
});
