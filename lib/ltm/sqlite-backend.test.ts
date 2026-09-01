import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SqliteBackend,
  sanitizeFtsQuery,
  truncateContent,
} from "./sqlite-backend.ts";

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

test("busy_timeout is set before journal_mode=WAL (LTM-8)", () => {
  const source = readFileSync(
    new URL("./sqlite-backend.ts", import.meta.url),
    "utf8"
  );
  // The WAL switch needs a brief exclusive lock; when busy_timeout is applied
  // only after journal_mode=WAL, a concurrent writer can still hit SQLITE_BUSY
  // during the mode change. Asserted structurally (no injectable timing
  // trigger exists in a single synchronous connection).
  const busy = source.indexOf("PRAGMA busy_timeout");
  const wal = source.indexOf("PRAGMA journal_mode");
  assert.ok(busy !== -1 && wal !== -1);
  assert.ok(busy < wal, "busy_timeout must be set before journal_mode=WAL");
});

test("remember catch wraps ROLLBACK and rethrows original error (LTM-9)", () => {
  const source = readFileSync(
    new URL("./sqlite-backend.ts", import.meta.url),
    "utf8"
  );
  // A ROLLBACK failure (e.g. SQLITE_BUSY on a concurrent write) must not mask
  // the original error that triggered the catch, nor leave the catch branch
  // itself throwing. Asserted structurally: ROLLBACK is wrapped in its own
  // try/catch and only logged on failure.
  assert.match(
    source,
    /try\s*\{[^{}]*db\.exec\("ROLLBACK"\)[^{}]*\}\s*catch\s*\(/
  );
  assert.match(source, /console\.error\([^)]*ROLLBACK[^)]*\)/);
});

test("truncateContent does not split a UTF-16 surrogate pair", () => {
  // Exactly CONTENT_MAX "a"s + an emoji (2 UTF-16 units). A raw slice(0, 8000)
  // would leave a lone high surrogate at the boundary (rendered as U+FFFD);
  // the helper must back off one unit to keep the pair intact.
  const content = "a".repeat(8000) + "😀";
  const t = truncateContent(content, 8000);
  assert.equal(t.length, 8000);
  assert.equal(t, "a".repeat(8000));
  assert.ok(!/[\uD800-\uDBFF]$/.test(t));

  // A lone high surrogate sitting exactly at the cut is also trimmed.
  assert.equal(truncateContent("x".repeat(5) + "\uD83D", 5), "x".repeat(5));

  // Under the limit: returned unchanged.
  assert.equal(truncateContent("hi", 8000), "hi");
});

test("observe deduplicates identical key within 60s window", async () => {
  await withTempBackend(async (backend) => {
    const base = {
      projectId: "proj_dd",
      sessionId: "sess1",
      kind: "agent_end" as const,
      title: "fix login",
    };
    const first = await backend.observe({
      ...base,
      narrative: "first narrative",
    });
    assert.ok("observationId" in first);

    // Same project + session + kind + title inside the window: deduplicated,
    // even when the narrative differs.
    const second = await backend.observe({
      ...base,
      narrative: "a totally different narrative",
    });
    assert.deepEqual(second, { deduplicated: true });

    // Only one row persisted.
    const hits = await backend.recall({
      projectId: "proj_dd",
      query: "narrative",
      kinds: ["observation"],
      limit: 10,
    });
    assert.equal(hits.length, 1);
  });
});

test("observe dedup does not collapse distinct keys", async () => {
  await withTempBackend(async (backend) => {
    const base = {
      projectId: "proj_dd2",
      sessionId: "sess1",
      kind: "agent_end" as const,
      narrative: "n",
    };
    const a = await backend.observe({ ...base, title: "t1" });
    const b = await backend.observe({ ...base, title: "t2" });
    assert.ok("observationId" in a);
    assert.ok("observationId" in b);

    // Same key under a different session is not deduplicated either.
    const c = await backend.observe({
      ...base,
      sessionId: "sess2",
      title: "t1",
    });
    assert.ok("observationId" in c);
  });
});

test("forget promotes newest descendant back to latest (LTM-11)", async () => {
  await withTempBackend(async (backend) => {
    const first = await backend.remember({
      projectId: "proj_chain",
      content: "use path resolve for session root directory layout",
      type: "preference",
    });
    const second = await backend.remember({
      projectId: "proj_chain",
      content: "use path resolve for session root directory layout please",
      type: "preference",
    });
    // second superseded first: only second is visible.
    const before = await backend.recall({
      projectId: "proj_chain",
      query: "path resolve",
      kinds: ["memory"],
      limit: 10,
    });
    assert.equal(before.length, 1);
    assert.equal(before[0]!.id, second.id);

    const r = await backend.forget({
      projectId: "proj_chain",
      memoryIds: [second.id],
    });
    assert.equal(r.deleted, 1);

    // The historical version must become visible again as the latest.
    const after = await backend.recall({
      projectId: "proj_chain",
      query: "path resolve",
      kinds: ["memory"],
      limit: 10,
    });
    assert.equal(after.length, 1);
    assert.equal(after[0]!.id, first.id);

    const stats = await backend.stats("proj_chain");
    assert.equal(stats.memoryCount, 1);
  });
});

test("forget latest with no descendants leaves zero latest", async () => {
  await withTempBackend(async (backend) => {
    const mem = await backend.remember({
      projectId: "proj_solo",
      content: "solo memory no descendants",
    });
    await backend.forget({ projectId: "proj_solo", memoryIds: [mem.id] });
    const stats = await backend.stats("proj_solo");
    assert.equal(stats.memoryCount, 0);
  });
});

test("close runs wal_checkpoint(TRUNCATE) before db.close (LTM-12)", () => {
  const source = readFileSync(
    new URL("./sqlite-backend.ts", import.meta.url),
    "utf8"
  );
  // Without an explicit checkpoint the recent writes live only in the -wal
  // file; close() must fold them into the main DB so the on-disk database is
  // self-contained. Asserted structurally (no injectable trigger exists in a
  // single synchronous connection), and the checkpoint must be best-effort.
  assert.match(source, /wal_checkpoint\(\s*TRUNCATE\s*\)/i);
  assert.match(source, /try\s*\{[^{}]*wal_checkpoint[^{}]*\}\s*catch\s*\(/);
  assert.match(source, /console\.error\([^)]*checkpoint[^)]*\)/i);
});

test("CJK substring queries are recallable via trigram (CJK-1)", async () => {
  await withTempBackend(async (backend) => {
    await backend.remember({
      projectId: "proj_cjk",
      content: "项目使用 SQLite 存储长期记忆，检索走 FTS5 全文索引",
    });
    const hits = await backend.recall({
      projectId: "proj_cjk",
      query: "长期记忆",
      limit: 5,
    });
    assert.ok(hits.length > 0, "CJK substring query should hit via trigram");
  });
});

test("short CJK queries fall back to LIKE when trigram cannot match (CJK-2)", async () => {
  await withTempBackend(async (backend) => {
    await backend.remember({
      projectId: "proj_like",
      content: "压缩前要把即将被摘要的分支文本存进 observations 表",
    });
    const hits = await backend.recall({
      projectId: "proj_like",
      query: "压缩",
      limit: 5,
    });
    assert.ok(hits.length > 0, "2-char CJK query should hit via LIKE fallback");
  });
});

test("LIKE fallback does not leak across projects (CJK-3)", async () => {
  await withTempBackend(async (backend) => {
    await backend.remember({
      projectId: "proj_x",
      content: "用户偏好：回复简洁直接，不要客套话",
    });
    const hits = await backend.recall({
      projectId: "proj_y",
      query: "偏好",
      limit: 5,
    });
    assert.equal(hits.length, 0);
  });
});

test("CJK revision of an existing memory supersedes it (CJK-4)", async () => {
  await withTempBackend(async (backend) => {
    const first = await backend.remember({
      projectId: "proj_sup",
      content: "长期记忆模块使用 SQLite 的 FTS5 做中文检索，需要 trigram 分词",
    });
    const second = await backend.remember({
      projectId: "proj_sup",
      content: "长期记忆用 SQLite FTS5 做中文检索，必须启用 trigram tokenizer 才支持中文",
    });
    const stats = await backend.stats("proj_sup");
    assert.equal(stats.memoryCount, 1, "near-duplicate CJK save should supersede");
    assert.notEqual(second.id, first.id);
  });
});

test("migration rebuilds a legacy unicode61 FTS index with trigram (CJK-5)", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "ltm-mig-"));
  const dbPath = join(dir, "legacy.sqlite");
  try {
    // Simulate a pre-CJK database: base tables + FTS without tokenizer.
    {
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE memories (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL,
          title TEXT NOT NULL, content TEXT NOT NULL, concepts_json TEXT,
          files_json TEXT, source_observation_ids_json TEXT,
          is_latest INTEGER NOT NULL, parent_id TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE observations (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL,
          kind TEXT NOT NULL, title TEXT NOT NULL, narrative TEXT NOT NULL,
          source_json TEXT, created_at TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE memories_fts USING fts5(
          id UNINDEXED, project_id UNINDEXED, title, content
        );
        INSERT INTO memories VALUES (
          'mem_legacy', 'proj_legacy', 'fact', '存储长期记忆标题',
          '项目使用 SQLite 存储长期记忆', NULL, NULL, NULL, 1, NULL,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO memories_fts(id, project_id, title, content)
          VALUES ('mem_legacy', 'proj_legacy', '存储长期记忆标题', '项目使用 SQLite 存储长期记忆');
      `);
      db.close();
    }
    const backend = new SqliteBackend(dbPath);
    try {
      const hits = await backend.recall({
        projectId: "proj_legacy",
        query: "长期记忆",
        limit: 5,
      });
      assert.ok(hits.length > 0, "legacy row should be recallable after migration");
    } finally {
      await backend.close?.();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
