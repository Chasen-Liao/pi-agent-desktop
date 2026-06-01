import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { withFileLock } from "./session-lock.ts";

declare global {
  var __piWriteLocks: Map<string, Promise<unknown>> | undefined;
}

beforeEach(() => {
  globalThis.__piWriteLocks = undefined;
});

test("serializes 100 concurrent calls on same path", async () => {
  const target = path.resolve("/tmp/lock-test-A");
  const order: number[] = [];
  const tasks = Array.from({ length: 100 }, (_, i) =>
    withFileLock(target, async () => {
      const prev = order[order.length - 1] ?? -1;
      assert.equal(i, prev + 1, `task ${i} ran out of order (prev was ${prev})`);
      order.push(i);
      await new Promise((r) => setImmediate(r));
    }),
  );
  await Promise.all(tasks);
  assert.equal(order.length, 100);
  assert.equal(order[0], 0);
  assert.equal(order[99], 99);
});

test("does not block calls on different paths", async () => {
  const a = path.resolve("/tmp/lock-test-B");
  const b = path.resolve("/tmp/lock-test-C");
  const start = Date.now();
  await Promise.all([
    withFileLock(a, async () => {
      await new Promise((r) => setTimeout(r, 100));
    }),
    withFileLock(b, async () => {
      await new Promise((r) => setTimeout(r, 100));
    }),
  ]);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 180, `expected < 180ms, got ${elapsed}ms`);
});

test("releases lock when fn throws", async () => {
  const target = path.resolve("/tmp/lock-test-D");
  await assert.rejects(
    withFileLock(target, async () => {
      throw new Error("intentional");
    }),
    /intentional/,
  );
  const start = Date.now();
  await withFileLock(target, async () => {});
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 50, `lock not released: ${elapsed}ms wait`);
});

test("cleans up map entry after release", async () => {
  const target = path.resolve("/tmp/lock-test-E");
  await withFileLock(target, async () => {});
  const map = globalThis.__piWriteLocks;
  if (map !== undefined) {
    assert.equal(map.has(target), false, "map should not contain entry after release");
  }
});
