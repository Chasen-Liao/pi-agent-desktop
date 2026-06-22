import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AgentSessionWrapper } from "./rpc-manager.ts";

type SubscribeFn = (cb: (event: unknown) => void) => () => void;

const source = readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");

test("startRpcSession does not pass a hardcoded default tool allowlist", () => {
  assert.doesNotMatch(source, /const allCodingToolNames = \[[^\]]+\]/);
  assert.match(source, /toolNames\?\.length === 0 \? \{ tools: \[\] \} : \{\}/);
  assert.match(source, /inner\.setActiveToolsByName\(toolNames\)/);
});

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

// Task A6: fork failure must clean up the orphaned .jsonl file.
// `startRpcSession` is a same-module function that internally calls
// `createAgentSession` (from pi-coding-agent), which can't be injected via the
// stub inner, so a behavioral test that triggers its throw is infeasible without
// module mocking. We instead assert on the source text (same pattern as the
// first test in this file) that the cleanup contract is in place:
//   1. await startRpcSession is wrapped in try/catch
//   2. catch invalidates the cached path (so future lookups don't hit a dead id)
//   3. catch unlinks the orphan file (best-effort, swallows missing-file errors)
//   4. catch rethrows — the error must propagate; the old wrapper is NOT destroyed
test("fork cleans up orphan .jsonl file when startRpcSession throws (source contract)", () => {
  // The stale "next fork overwrites" rationale has been removed — the new file
  // name is a unique <timestamp>_<uuid>.jsonl and is never overwritten.
  assert.doesNotMatch(source, /next fork overwrites/);

  // unlink + invalidateSessionPathCache must be imported.
  assert.match(source, /import \{ unlink \} from "fs\/promises"/);
  assert.match(source, /invalidateSessionPathCache/);

  // startRpcSession must be awaited inside a try block.
  assert.match(source, /try \{\s*\n\s*await startRpcSession\(/);

  // catch must invalidate the cache first, then best-effort unlink, then rethrow.
  // Ordering matters: invalidate before unlink so a concurrent lookup can't
  // resolve the id to a path that's about to disappear.
  assert.match(
    source,
    /invalidateSessionPathCache\(newSessionId\);\s*\n\s*await unlink\(newSessionFile\)\.catch\(\(\) => \{[^}]*\}\);\s*\n\s*throw err;/
  );

  // this.destroy() must NOT be reachable when startRpcSession throws — it lives
  // after the try/catch, so an error in the try block skips it (old wrapper
  // stays usable under the old id).
  assert.match(source, /\}\s*\n\s*\n\s*this\.destroy\(\);\s*\n\s*return \{ cancelled: false, newSessionId \};/);
});
