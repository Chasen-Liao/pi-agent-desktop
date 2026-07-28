import test from "node:test";
import assert from "node:assert/strict";
import { resolveForkedSession } from "./fork-session-wait.ts";

test("resolveForkedSession returns session on first list hit without sleeping", async () => {
  const sleeps: number[] = [];
  const result = await resolveForkedSession(
    "fork-1",
    async () => [{ id: "fork-1", name: "ok" }],
    undefined,
    {
      delaysMs: [50, 100],
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }
  );
  assert.deepEqual(result, { id: "fork-1", name: "ok" });
  assert.deepEqual(sleeps, []);
});

test("resolveForkedSession retries list then finds session", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const result = await resolveForkedSession(
    "fork-2",
    async () => {
      calls += 1;
      if (calls < 3) return [{ id: "other" }];
      return [{ id: "fork-2" }];
    },
    undefined,
    {
      delaysMs: [10, 20, 30],
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }
  );
  assert.equal(result?.id, "fork-2");
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [10, 20]);
});

test("resolveForkedSession falls back to fetchOne after list exhaustion", async () => {
  let listCalls = 0;
  let oneCalls = 0;
  const result = await resolveForkedSession(
    "fork-3",
    async () => {
      listCalls += 1;
      return [];
    },
    async (id) => {
      oneCalls += 1;
      return { id };
    },
    {
      delaysMs: [1, 1],
      sleep: async () => {},
    }
  );
  assert.deepEqual(result, { id: "fork-3" });
  assert.ok(listCalls >= 2);
  assert.equal(oneCalls, 1);
});

test("resolveForkedSession returns null when list and fetchOne miss", async () => {
  const result = await resolveForkedSession(
    "ghost",
    async () => [],
    async () => null,
    { delaysMs: [1], sleep: async () => {} }
  );
  assert.equal(result, null);
});
