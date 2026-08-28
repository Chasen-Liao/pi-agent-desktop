import test from "node:test";
import assert from "node:assert/strict";
import { getNextCrashReloadState } from "./crash-recovery.ts";

test("getNextCrashReloadState allows up to three crash reloads inside the window", () => {
  assert.deepEqual(getNextCrashReloadState({ now: 1_000, reason: "crashed", attempts: [], isQuitting: false }), {
    shouldReload: true,
    attempts: [1_000],
  });
  assert.deepEqual(
    getNextCrashReloadState({ now: 1_500, reason: "oom", attempts: [1_000, 1_250], isQuitting: false }),
    {
      shouldReload: true,
      attempts: [1_000, 1_250, 1_500],
    }
  );
  assert.deepEqual(
    getNextCrashReloadState({ now: 2_000, reason: "crashed", attempts: [1_000, 1_500, 1_750], isQuitting: false }),
    {
      shouldReload: false,
      attempts: [1_000, 1_500, 1_750],
    }
  );
});

test("getNextCrashReloadState never reloads on clean-exit or while quitting", () => {
  assert.equal(getNextCrashReloadState({ now: 1_000, reason: "clean-exit", attempts: [], isQuitting: false }).shouldReload, false);
  assert.equal(getNextCrashReloadState({ now: 1_000, reason: "crashed", attempts: [], isQuitting: true }).shouldReload, false);
});

test("getNextCrashReloadState expires old attempts outside the window", () => {
  assert.deepEqual(
    getNextCrashReloadState({ now: 120_000, reason: "crashed", attempts: [1_000, 2_000, 3_000], isQuitting: false }),
    {
      shouldReload: true,
      attempts: [120_000],
    }
  );
});
