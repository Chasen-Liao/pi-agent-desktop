import test from "node:test";
import assert from "node:assert/strict";
import { fetchStatusline, formatStatusline } from "./statusline.ts";
import type { StatuslineResponse } from "@/lib/types";

/**
 * Behavioural coverage for the status line helpers.
 *
 * These used to be asserted by matching the hook's source text, which could
 * not tell a working command from a broken one.
 */

const REPO_STATUS: StatuslineResponse = {
  cwd: "/tmp/proj",
  isRepo: true,
  branch: "main",
  ahead: 2,
  behind: 1,
  modified: 3,
  staged: 1,
  untracked: 4,
  deleted: 5,
  lastCommit: { hash: "abcdef1234567890", subject: "initial commit" },
};

async function withStubbedFetch(
  handler: () => Response,
  fn: () => Promise<void>
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => handler()) as unknown as typeof globalThis.fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("formatStatusline summarises the repo with symbols only", () => {
  const text = formatStatusline(REPO_STATUS);
  assert.match(text, /`main`/);
  assert.match(text, /↑2/);
  assert.match(text, /↓1/);
  assert.match(text, /\+1/);
  assert.match(text, /~3/);
  assert.match(text, /\?4/);
  assert.match(text, /−5/);
  assert.match(text, /`abcdef1` initial commit/);
});

test("formatStatusline omits counters that are zero", () => {
  const text = formatStatusline({
    cwd: "/tmp/proj",
    isRepo: true,
    branch: "main",
    modified: 0,
    staged: 0,
    untracked: 0,
    deleted: 0,
  });
  assert.equal(text, "`main`");
});

test("formatStatusline reports a non-repo directory", () => {
  assert.equal(formatStatusline({ cwd: "/tmp/x", isRepo: false, modified: 0, staged: 0, untracked: 0, deleted: 0 }), "—");
  assert.equal(
    formatStatusline({
      cwd: "/tmp/x",
      isRepo: false,
      modified: 0,
      staged: 0,
      untracked: 0,
      deleted: 0,
      error: "not a git repository",
    }),
    "— not a git repository"
  );
});

test("fetchStatusline returns the payload on success", async () => {
  await withStubbedFetch(
    () =>
      new Response(JSON.stringify(REPO_STATUS), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    async () => {
      const status = await fetchStatusline("/tmp/proj");
      assert.equal(status.branch, "main");
      assert.equal(status.isRepo, true);
    }
  );
});

test("fetchStatusline throws with the server's reason instead of returning an empty status", async () => {
  await withStubbedFetch(
    () =>
      new Response(JSON.stringify({ error: "cwd not in allowed roots" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    async () => {
      await assert.rejects(() => fetchStatusline("/tmp/proj"), /cwd not in allowed roots/);
    }
  );
});

test("fetchStatusline falls back to the status code when the body carries no reason", async () => {
  await withStubbedFetch(
    () => new Response("{}", { status: 500, headers: { "Content-Type": "application/json" } }),
    async () => {
      await assert.rejects(() => fetchStatusline("/tmp/proj"), /HTTP 500/);
    }
  );
});
