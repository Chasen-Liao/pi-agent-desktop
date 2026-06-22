import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AgentSessionWrapper } from "./rpc-manager.ts";

type SubscribeFn = (cb: (event: unknown) => void) => () => void;

const source = readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");

// destroy() is async (Task B3). After mock.timers.tick() fires the idle
// timer, the destroy Promise needs a microtask cycle to settle before
// onDestroy callbacks become observable. setImmediate flushes the microtask
// queue without itself being mocked by mock.timers.
const flushMicrotasks = (): Promise<void> => new Promise((r) => setImmediate(r));

test("startRpcSession does not pass a hardcoded default tool allowlist", () => {
  assert.doesNotMatch(source, /const allCodingToolNames = \[[^\]]+\]/);
  assert.match(source, /toolNames\?\.length === 0 \? \{ tools: \[\] \} : \{\}/);
  assert.match(source, /inner\.setActiveToolsByName\(toolNames\)/);
});

function makeStubInner(overrides: {
  subscribe?: SubscribeFn;
  sessionManager?: unknown;
  model?: unknown;
  agent?: unknown;
} = {}) {
  return {
    sessionId: "stub",
    sessionFile: "stub.jsonl",
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: false,
    autoRetryEnabled: false,
    model: overrides.model ?? null,
    getContextUsage: () => null,
    agent: overrides.agent ?? { state: { systemPrompt: "", thinkingLevel: "off" } },
    sessionManager: overrides.sessionManager ?? null,
    modelRegistry: null,
    subscribe: overrides.subscribe ?? ((cb: (event: unknown) => void) => { void cb; return () => {}; }),
  } as never;
}

test("wrapper is destroyed after 10 min of inactivity", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = new AgentSessionWrapper(makeStubInner());
    let destroyed = false;
    w.onDestroy(() => { destroyed = true; });
    w.start();

    mock.timers.tick(9 * 60 * 1000);
    assert.equal(destroyed, false, "should still be alive after 9 min");

    mock.timers.tick(60 * 1000);
    await flushMicrotasks();
    assert.equal(destroyed, true, "should be destroyed after 10 min");
  } finally {
    mock.timers.reset();
  }
});

test("keepAlive resets the idle timer", async () => {
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
    await flushMicrotasks();
    assert.equal(destroyed, true, "should be destroyed 10 min after keepAlive");
  } finally {
    mock.timers.reset();
  }
});

test("events reset the idle timer (regression)", async () => {
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
    await flushMicrotasks();
    assert.equal(destroyed, true, "should be destroyed 10 min after last event");
  } finally {
    mock.timers.reset();
  }
});

test("keepAlive is a no-op on a destroyed wrapper", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = new AgentSessionWrapper(makeStubInner());
    let destroyed = false;
    w.onDestroy(() => { destroyed = true; });
    w.start();

    // Force destruction via idle timeout
    mock.timers.tick(10 * 60 * 1000);
    await flushMicrotasks();
    assert.equal(destroyed, true);

    // keepAlive after destroy must not schedule a new timer or throw.
    // If it scheduled a timer, ticking past 10 min would NOT cause
    // observable harm (the timer's destroy() is idempotent), but the
    // contract is: no-op on dead wrapper.
    w.keepAlive();
    mock.timers.tick(20 * 60 * 1000);
    await flushMicrotasks();
    // Still only one onDestroy call (the original). No error thrown.
    assert.equal(destroyed, true);
  } finally {
    mock.timers.reset();
  }
});

test("peekState does NOT reset the idle timer (regression for Task B2)", async () => {
  // Polling GET /api/sessions/[id]?includeState=1 calls peekState(). If it
  // reset the idle timer, any polling client would keep idle sessions alive
  // forever. We assert the opposite: a wrapper that has been idle for 9 min
  // is still destroyed at the 10-min mark even if peekState() was called
  // during that window.
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = new AgentSessionWrapper(makeStubInner());
    let destroyed = false;
    w.onDestroy(() => { destroyed = true; });
    w.start();

    mock.timers.tick(9 * 60 * 1000);
    assert.equal(destroyed, false, "should still be alive at 9 min");

    // A polling client observes state — this must NOT extend the lifetime.
    const snapshot = w.peekState();
    assert.equal(snapshot.sessionId, "stub");
    assert.equal(snapshot.isStreaming, false);

    mock.timers.tick(30 * 1000);
    assert.equal(destroyed, false, "should still be alive at 9:30 (only 30s since peek)");

    mock.timers.tick(30 * 1000);
    await flushMicrotasks();
    assert.equal(destroyed, true, "peekState must not reset the 10-min idle timer");
  } finally {
    mock.timers.reset();
  }
});

test("send({type:'get_state'}) DOES reset the idle timer (explicit control)", async () => {
  // Callers that intentionally drive the session use send(), which keeps the
  // wrapper alive. This guards the contract documented on peekState().
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = new AgentSessionWrapper(makeStubInner());
    let destroyed = false;
    w.onDestroy(() => { destroyed = true; });
    w.start();

    mock.timers.tick(9 * 60 * 1000);
    assert.equal(destroyed, false);

    const state = await w.send({ type: "get_state" });
    assert.equal((state as { sessionId: string }).sessionId, "stub");

    // 9 more minutes since the send() call — would cross 10 min if not reset.
    mock.timers.tick(9 * 60 * 1000);
    assert.equal(destroyed, false, "send({type:'get_state'}) should reset the idle timer");

    mock.timers.tick(60 * 1000);
    await flushMicrotasks();
    assert.equal(destroyed, true, "should be destroyed 10 min after last send");
  } finally {
    mock.timers.reset();
  }
});

test("peekState and send get_state return the same payload shape", async () => {
  const w = new AgentSessionWrapper(makeStubInner());
  const peeked = w.peekState();
  const sent = await w.send({ type: "get_state" });
  assert.deepEqual(peeked, sent, "peekState must mirror get_state payload");
});

// Defense-in-depth: if someone accidentally reintroduces resetIdleTimer into
// peekState (e.g. by copy-pasting send), this source-text assertion catches
// it at test time without needing to construct a live inner.
test("peekState source does not reference resetIdleTimer", () => {
  const peekFnMatch = source.match(/peekState\(\)[^{]*\{[\s\S]*?\n  \}/);
  assert.ok(peekFnMatch, "peekState method should exist in source");
  assert.doesNotMatch(peekFnMatch[0], /resetIdleTimer/);
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
  // stays usable under the old id). destroy() is async (Task B3), so it must
  // be awaited here — the await also ensures the old wrapper is fully torn
  // down (unsubscribe + onDestroy callbacks) before send() returns.
  assert.match(source, /\}\s*\n\s*\n\s*await this\.destroy\(\);\s*\n\s*return \{ cancelled: false, newSessionId \};/);
});

// Task B3: destroy() must be async and await both the unsubscribe fn and
// onDestroy callbacks. The current pi subscribe() returns `() => void`, but
// if it ever returns an async cleanup fn (e.g. to release an underlying
// subscription), the old `this.unsubscribe?.()` without await would not wait
// for cleanup to finish before GC. Same reasoning for onDestroy callbacks —
// some may want to flush resources asynchronously.
test("destroy() awaits the unsubscribe fn and onDestroy callbacks", async () => {
  let unsubResolved = false;
  let cbResolved = false;
  // unsubscribe returns a Promise (simulates a future async cleanup fn).
  // TypeScript allows `() => Promise<void>` where `() => void` is expected.
  const unsubscribe = (): Promise<void> =>
    new Promise((resolve) =>
      setTimeout(() => {
        unsubResolved = true;
        resolve();
      }, 5)
    );
  const inner = makeStubInner({
    subscribe: () => unsubscribe as unknown as () => void,
  });
  const w = new AgentSessionWrapper(inner);
  w.start();
  w.onDestroy(
    () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          cbResolved = true;
          resolve();
        }, 5)
      ) as unknown as void
  );

  await w.destroy();

  // Both the async unsubscribe and the async callback must have completed
  // before destroy()'s Promise resolved — that is the contract await gives us.
  assert.equal(unsubResolved, true, "destroy must await the async unsubscribe");
  assert.equal(cbResolved, true, "destroy must await async onDestroy callbacks");
  assert.equal(w.isAlive(), false);
});

test("destroy() swallows errors from the async unsubscribe (other callbacks still run)", async () => {
  // If unsubscribe throws (sync) or rejects (async), destroy must catch it
  // and continue running onDestroy callbacks — otherwise a failing
  // unsubscribe would leak the registered callbacks.
  let cbCalled = false;
  const unsubscribe = () => Promise.reject(new Error("unsubscribe boom"));
  const inner = makeStubInner({
    subscribe: () => unsubscribe as unknown as () => void,
  });
  const w = new AgentSessionWrapper(inner);
  w.start();
  w.onDestroy(() => {
    cbCalled = true;
  });

  await w.destroy();
  assert.equal(cbCalled, true, "onDestroy callbacks must run even if unsubscribe rejects");
  assert.equal(w.isAlive(), false);
});

test("destroy() is idempotent (async)", async () => {
  let cbCount = 0;
  const w = new AgentSessionWrapper(makeStubInner());
  w.onDestroy(() => {
    cbCount++;
  });
  w.start();

  await w.destroy();
  await w.destroy(); // second call must be a no-op (early return on !_alive)
  assert.equal(cbCount, 1, "onDestroy callback must fire exactly once");
  assert.equal(w.isAlive(), false);
});

// Source-text contract: guards all the Task B3 invariants at compile time so
// that an accidental revert (e.g. someone drops the await or the .catch on
// the idle timer) is caught without constructing a live inner.
test("destroy() source matches the Task B3 contract", () => {
  // destroy is declared `async destroy(): Promise<void>`
  assert.match(source, /async destroy\(\): Promise<void>/);
  // unsubscribe is awaited inside try/catch
  assert.match(
    source,
    /try \{\s*\n\s*await this\.unsubscribe\?\.\(\);\s*\n\s*\} catch \(err\) \{\s*\n\s*console\.error\("Error during unsubscribe:", err\);\s*\n\s*\}/
  );
  // onDestroy callbacks are awaited (so async callbacks work)
  assert.match(source, /await cb\(\)/);
  // idle timer callback must handle the now-Promise return — an unhandled
  // rejection inside setTimeout would crash the process.
  assert.match(
    source,
    /this\.destroy\(\)\.catch\(\(err\) => console\.error\("Error during idle destroy:", err\)\)/
  );
  // process exit / signal cleanup must handle the Promise per-wrapper too.
  assert.match(
    source,
    /s\.destroy\(\)\.catch\(\(err\) => console\.error\("Error during exit destroy:", err\)\)/
  );
});

// ============================================================================
// Task D3: applyDeepSeekXhighWorkaround
// Isolated hack that forces state.thinkingLevel back to "xhigh" after
// setThinkingLevel clamps it to "high" for deepseek-compat models.
// ============================================================================

// The workaround is a private method; access it via a typed cast for testing.
function callDeepSeekWorkaround(w: AgentSessionWrapper, level: string): boolean {
  return (w as unknown as { applyDeepSeekXhighWorkaround(level: string): boolean })
    .applyDeepSeekXhighWorkaround(level);
}

test("applyDeepSeekXhighWorkaround: forces state.thinkingLevel back to xhigh on deepseek models", () => {
  // Simulate the post-clamp state: setThinkingLevel already ran and set "high".
  const state = { systemPrompt: "", thinkingLevel: "high" };
  const inner = makeStubInner({
    model: { id: "deepseek-reasoner", provider: "deepseek", compat: { thinkingFormat: "deepseek" } },
    agent: { state },
  });
  const w = new AgentSessionWrapper(inner);

  assert.equal(callDeepSeekWorkaround(w, "xhigh"), true);
  assert.equal(state.thinkingLevel, "xhigh", "state.thinkingLevel must be forced back to xhigh");
});

test("applyDeepSeekXhighWorkaround: no-op for non-deepseek thinking format", () => {
  const state = { systemPrompt: "", thinkingLevel: "high" };
  const inner = makeStubInner({
    model: { id: "gpt-5", provider: "openai", compat: { thinkingFormat: "openai" } },
    agent: { state },
  });
  const w = new AgentSessionWrapper(inner);

  assert.equal(callDeepSeekWorkaround(w, "xhigh"), false);
  assert.equal(state.thinkingLevel, "high", "state.thinkingLevel must not change for non-deepseek");
});

test("applyDeepSeekXhighWorkaround: no-op when level is not xhigh", () => {
  const state = { systemPrompt: "", thinkingLevel: "high" };
  const inner = makeStubInner({
    model: { id: "deepseek-reasoner", provider: "deepseek", compat: { thinkingFormat: "deepseek" } },
    agent: { state },
  });
  const w = new AgentSessionWrapper(inner);

  assert.equal(callDeepSeekWorkaround(w, "high"), false);
  assert.equal(state.thinkingLevel, "high", "state.thinkingLevel must not change for non-xhigh levels");
});

test("applyDeepSeekXhighWorkaround: no-op when model has no compat field", () => {
  const state = { systemPrompt: "", thinkingLevel: "high" };
  const inner = makeStubInner({
    model: { id: "plain-model", provider: "p" },
    agent: { state },
  });
  const w = new AgentSessionWrapper(inner);

  assert.equal(callDeepSeekWorkaround(w, "xhigh"), false);
  assert.equal(state.thinkingLevel, "high", "state.thinkingLevel must not change when compat is absent");
});

test("applyDeepSeekXhighWorkaround: no-op when agent.state is missing", () => {
  const inner = makeStubInner({
    model: { id: "deepseek-reasoner", provider: "deepseek", compat: { thinkingFormat: "deepseek" } },
    agent: { state: undefined },
  });
  const w = new AgentSessionWrapper(inner);

  assert.equal(callDeepSeekWorkaround(w, "xhigh"), false);
});

test("applyDeepSeekXhighWorkaround: no-op when model is null (default stub)", () => {
  const inner = makeStubInner(); // model defaults to null
  const w = new AgentSessionWrapper(inner);

  assert.equal(callDeepSeekWorkaround(w, "xhigh"), false);
});
