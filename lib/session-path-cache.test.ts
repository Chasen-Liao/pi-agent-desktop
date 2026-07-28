import test from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_MISS_TTL_MS,
  createSessionPathCacheState,
  getCachedSessionPath,
  markSessionPathMiss,
  cacheSessionPathEntry,
  invalidateSessionPathEntry,
} from "./session-path-cache.ts";

test("unknown id is not a negative hit until marked miss", () => {
  const state = createSessionPathCacheState();
  const result = getCachedSessionPath(state, "missing-id", 1_000);
  assert.deepEqual(result, { hit: false, negative: false });
});

test("markSessionPathMiss blocks repeated full-scan windows", () => {
  const state = createSessionPathCacheState();
  const now = 10_000;
  markSessionPathMiss(state, "missing-id", now);

  const during = getCachedSessionPath(state, "missing-id", now + 1_000);
  assert.deepEqual(during, { hit: false, negative: true });

  const after = getCachedSessionPath(state, "missing-id", now + SESSION_MISS_TTL_MS + 1);
  assert.deepEqual(after, { hit: false, negative: false });
});

test("cacheSessionPathEntry clears negative miss and returns path", () => {
  const state = createSessionPathCacheState();
  markSessionPathMiss(state, "new-id", 1_000);
  cacheSessionPathEntry(state, "new-id", "/tmp/session.jsonl");

  const result = getCachedSessionPath(state, "new-id", 2_000);
  assert.deepEqual(result, { hit: true, path: "/tmp/session.jsonl" });
});

test("invalidateSessionPathEntry removes path and miss", () => {
  const state = createSessionPathCacheState();
  cacheSessionPathEntry(state, "x", "/a.jsonl");
  markSessionPathMiss(state, "y", 1_000);
  invalidateSessionPathEntry(state, "x");
  invalidateSessionPathEntry(state, "y");

  assert.deepEqual(getCachedSessionPath(state, "x", 2_000), { hit: false, negative: false });
  assert.deepEqual(getCachedSessionPath(state, "y", 2_000), { hit: false, negative: false });
});
