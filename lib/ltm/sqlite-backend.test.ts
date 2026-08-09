import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteBackend, sanitizeFtsQuery } from "./sqlite-backend.ts";

function withTempBackend(
  fn: (backend: SqliteBackend, dir: string) => Promise<void>
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "ltm-"));
  const backend = new SqliteBackend(join(dir, "t.sqlite"));
  return fn(backend, dir).finally(async () => {
    await backend.close?.();
    rmSync(dir, { recursive: true, force: true });
  });
}

test("remember and recall within project", async () => {
  await withTempBackend(async (backend) => {
    await backend.remember({
      projectId: "proj_aaa",
      content: "Prefer using path resolve for session roots",
      type: "preference",
    });
    const hits = await backend.recall({
      projectId: "proj_aaa",
      query: "session roots",
      limit: 5,
    });
    assert.ok(hits.some((h) => h.kind === "memory"));
  });
});

test("recall does not leak across projects", async () => {
  await withTempBackend(async (backend) => {
    await backend.remember({
      projectId: "proj_a",
      content: "unique zebra widget convention",
    });
    const hits = await backend.recall({
      projectId: "proj_b",
      query: "zebra widget",
      limit: 5,
    });
    assert.equal(hits.length, 0);
  });
});

test("observe agent_end is recallable", async () => {
  await withTempBackend(async (backend) => {
    await backend.observe({
      projectId: "proj_a",
      sessionId: "sess1",
      kind: "agent_end",
      title: "fix login",
      narrative: "User: fix login\nAssistant: patched auth middleware",
    });
    const hits = await backend.recall({
      projectId: "proj_a",
      query: "auth middleware",
      kinds: ["observation"],
    });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]!.kind, "observation");
  });
});

test("remember supersedes high-jaccard latest memory", async () => {
  await withTempBackend(async (backend) => {
    const first = await backend.remember({
      projectId: "proj_s",
      content: "use path resolve for session root directory layout",
      type: "preference",
    });
    const second = await backend.remember({
      projectId: "proj_s",
      content: "use path resolve for session root directory layout please",
      type: "preference",
    });
    assert.notEqual(first.id, second.id);

    const hits = await backend.recall({
      projectId: "proj_s",
      query: "path resolve session",
      kinds: ["memory"],
      limit: 10,
    });
    // Only latest version should appear
    assert.ok(hits.every((h) => h.id === second.id));
    assert.ok(hits.some((h) => h.id === second.id));

    const stats = await backend.stats("proj_s");
    assert.equal(stats.memoryCount, 1);
  });
});

test("forget deletes by id within project", async () => {
  await withTempBackend(async (backend) => {
    const mem = await backend.remember({
      projectId: "proj_f",
      content: "forgettable alpha bravo convention",
    });
    const obs = await backend.observe({
      projectId: "proj_f",
      sessionId: "s1",
      kind: "agent_end",
      title: "t",
      narrative: "forgettable charlie delta narrative text",
    });
    assert.ok("observationId" in obs);

    const deleted = await backend.forget({
      projectId: "proj_f",
      memoryIds: [mem.id],
      observationIds: [obs.observationId],
    });
    assert.equal(deleted.deleted, 2);

    const hits = await backend.recall({
      projectId: "proj_f",
      query: "forgettable",
      limit: 10,
    });
    assert.equal(hits.length, 0);
  });
});

test("forget does not delete other project rows", async () => {
  await withTempBackend(async (backend) => {
    const mem = await backend.remember({
      projectId: "proj_x",
      content: "shared keyword pineapple",
    });
    await backend.remember({
      projectId: "proj_y",
      content: "shared keyword pineapple other",
    });
    const r = await backend.forget({
      projectId: "proj_y",
      memoryIds: [mem.id],
    });
    assert.equal(r.deleted, 0);
    const hits = await backend.recall({
      projectId: "proj_x",
      query: "pineapple",
      kinds: ["memory"],
    });
    assert.equal(hits.length, 1);
  });
});

test("health reports sqlite backend", async () => {
  await withTempBackend(async (backend) => {
    const h = await backend.health();
    assert.equal(h.ok, true);
    assert.equal(h.backend, "sqlite");
  });
});

test("creates parent directory for dbPath", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ltm-"));
  const nested = join(dir, "a", "b", "c.sqlite");
  try {
    const backend = new SqliteBackend(nested);
    assert.ok(existsSync(nested) || existsSync(join(dir, "a", "b")));
    await backend.remember({ projectId: "p", content: "nested db path works fine" });
    await backend.close?.();
    assert.ok(existsSync(nested));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sanitizeFtsQuery strips special chars and quotes tokens", () => {
  assert.equal(sanitizeFtsQuery('session roots'), '"session" "roots"');
  assert.equal(sanitizeFtsQuery('foo AND bar'), '"foo" "and" "bar"');
  assert.equal(sanitizeFtsQuery('a*b(c)'), '"a" "b" "c"');
  assert.equal(sanitizeFtsQuery("   "), "");
  assert.equal(sanitizeFtsQuery(""), "");
});

test("empty or garbage query returns no hits", async () => {
  await withTempBackend(async (backend) => {
    await backend.remember({ projectId: "p", content: "something stored" });
    const hits = await backend.recall({ projectId: "p", query: "***" });
    assert.equal(hits.length, 0);
  });
});

test("kinds filter memories only", async () => {
  await withTempBackend(async (backend) => {
    await backend.remember({
      projectId: "proj_k",
      content: "shared keyword orange muffin",
    });
    await backend.observe({
      projectId: "proj_k",
      sessionId: "s",
      kind: "pre_compact",
      title: "c",
      narrative: "shared keyword orange muffin observed",
    });
    const memOnly = await backend.recall({
      projectId: "proj_k",
      query: "orange muffin",
      kinds: ["memory"],
    });
    assert.ok(memOnly.every((h) => h.kind === "memory"));
    assert.ok(memOnly.length >= 1);

    const obsOnly = await backend.recall({
      projectId: "proj_k",
      query: "orange muffin",
      kinds: ["observation"],
    });
    assert.ok(obsOnly.every((h) => h.kind === "observation"));
    assert.ok(obsOnly.length >= 1);
  });
});

test("stats counts memories and observations", async () => {
  await withTempBackend(async (backend) => {
    await backend.remember({ projectId: "proj_st", content: "one memory about widgets" });
    await backend.observe({
      projectId: "proj_st",
      sessionId: "s",
      kind: "agent_end",
      title: "t",
      narrative: "one observation about widgets",
    });
    const s = await backend.stats("proj_st");
    assert.equal(s.memoryCount, 1);
    assert.equal(s.observationCount, 1);
    assert.deepEqual(await backend.stats("proj_other"), {
      memoryCount: 0,
      observationCount: 0,
    });
  });
});

test("remember wraps supersede + insert in a transaction (LTM-4)", () => {
  const source = readFileSync(new URL("./sqlite-backend.ts", import.meta.url), "utf8");
  // Crash consistency: the supersede UPDATE and the new-row INSERT must share
  // one transaction. Without it, a crash between the two leaves the old memory
  // un-latest (is_latest=0) with no replacement row — the fact "vanishes" from
  // recall. Not behavior-testable here: DatabaseSync is single synchronous
  // connection with no injectable failure point, so the guard is asserted
  // structurally (BEGIN/COMMIT/ROLLBACK around the writes).
  assert.match(source, /db\.exec\("BEGIN"/);
  assert.match(source, /db\.exec\("COMMIT"/);
  assert.match(source, /db\.exec\("ROLLBACK"/);
});

test("constructor sets a busy_timeout to avoid SQLITE_BUSY (LTM-5)", () => {
  const source = readFileSync(new URL("./sqlite-backend.ts", import.meta.url), "utf8");
  // WAL is enabled but a second handle (HMR-stale instance, concurrent test
  // open) writing at the same time would immediately throw SQLITE_BUSY
  // without a busy_timeout. Asserted structurally: no injectable timing
  // trigger exists in a single synchronous connection.
  assert.match(source, /PRAGMA busy_timeout\s*=\s*\d+/i);
});

test("remember truncates oversized content (LTM-6)", async () => {
  await withTempBackend(async (backend) => {
    const tail = "unique_tail_marker_xyz";
    const content = "A".repeat(20000) + " " + tail;
    await backend.remember({ projectId: "proj_l", content });

    // If content were stored untruncated, the tail token would be indexed and
    // searchable. Truncation must cut it away so the DB cannot bloat.
    const hits = await backend.recall({
      projectId: "proj_l",
      query: tail,
      kinds: ["memory"],
      limit: 10,
    });
    assert.equal(hits.length, 0);
  });
});
