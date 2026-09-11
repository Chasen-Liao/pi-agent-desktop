import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SqliteBackend,
  isBusyError,
  sanitizeFtsQuery,
  truncateContent,
  withBusyRetry,
  withBusyRetrySync,
} from "./sqlite-backend.ts";
import { DatabaseSync } from "node:sqlite";

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
  // trigger exists in a single synchronous connection. The value is
  // injectable via SqliteBackendOptions.busyTimeoutMs (tests use small
  // values), so the applied pragma is a template over that option and the
  // production default lives in DEFAULT_BUSY_TIMEOUT_MS.
  assert.match(source, /PRAGMA busy_timeout\s*=\s*\$\{busyTimeoutMs\}/);
  assert.match(source, /DEFAULT_BUSY_TIMEOUT_MS\s*=\s*\d+/);
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
  // trigger exists in a single synchronous connection). The needles are
  // anchored to the exec(...) statements, not the doc comments above them,
  // which mention the pragmas in a different order.
  const busy = source.indexOf("exec(`PRAGMA busy_timeout");
  const wal = source.indexOf('exec("PRAGMA journal_mode');
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

// ---------------------------------------------------------------------------
// Bounded SQLITE_BUSY retry ("database is locked")
//
// Experimentally, when the pi CLI holds `BEGIN IMMEDIATE` on the same
// ~/.pi/agent directory, contended statements fail in two shapes: fast
// (< ~1s, e.g. PRAGMA journal_mode = WAL or a reader-to-writer lock upgrade,
// neither of which honors busy_timeout) and slow (~busy_timeout already
// burned by a long transaction). Fast fails are transient — retry; slow
// fails mean the holder runs a long transaction — retry at most once.
// ---------------------------------------------------------------------------

function busyError(message = "database is locked"): Error {
  return Object.assign(new Error(message), {
    errcode: 5,
    errstr: "SQLITE_BUSY",
  });
}

test("isBusyError matches busy/locked errors by errcode and message", () => {
  assert.equal(isBusyError(busyError()), true);
  // Extended codes keep the primary code in the low byte
  // (SQLITE_BUSY_SNAPSHOT = 5 | (2 << 8) = 517).
  assert.equal(
    isBusyError(
      Object.assign(new Error("x"), { errcode: 517, errstr: "SQLITE_BUSY_SNAPSHOT" })
    ),
    true
  );
  assert.equal(
    isBusyError(Object.assign(new Error("x"), { errcode: 6, errstr: "SQLITE_LOCKED" })),
    true
  );
  assert.equal(
    isBusyError(
      Object.assign(new Error("table memories is locked"), {
        errstr: "SQLITE_LOCKED",
      })
    ),
    true
  );
  assert.equal(isBusyError(new Error("SQLITE_BUSY: database is locked")), true);
  assert.equal(isBusyError(new Error("boom")), false);
  assert.equal(isBusyError(new Error("UNIQUE constraint failed")), false);
  assert.equal(isBusyError(null), false);
  assert.equal(isBusyError(undefined), false);
  assert.equal(isBusyError("database is locked"), false);
});

test("withBusyRetry retries fast busy failures with doubling backoff", async () => {
  const sleeps: number[] = [];
  let attempts = 0;
  const result = await withBusyRetry(() => {
    attempts++;
    if (attempts < 3) throw busyError();
    return "ok";
  }, {
    maxAttempts: 4,
    backoffMs: 10,
    backoffMaxMs: 25,
    fastFailMs: 1000,
    sleep: (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  // First retry waits backoffMs, the second doubles but stays under the cap.
  assert.deepEqual(sleeps, [10, 20]);
});

test("withBusyRetry gives up after maxAttempts and rethrows the busy error", async () => {
  const sleeps: number[] = [];
  let attempts = 0;
  await assert.rejects(
    withBusyRetry(() => {
      attempts++;
      throw busyError();
    }, {
      maxAttempts: 3,
      backoffMs: 1,
      fastFailMs: 1000,
      sleep: (ms) => {
        sleeps.push(ms);
      },
    }),
    /database is locked/
  );
  assert.equal(attempts, 3);
  assert.equal(sleeps.length, 2);
});

test("withBusyRetry rethrows non-busy errors without retrying", async () => {
  let attempts = 0;
  await assert.rejects(
    withBusyRetry(() => {
      attempts++;
      throw new Error("UNIQUE constraint failed: memories.id");
    }, {
      maxAttempts: 5,
      backoffMs: 1,
      sleep: () => {},
    }),
    /UNIQUE constraint failed/
  );
  assert.equal(attempts, 1);
});

test("withBusyRetry retries a slow busy failure at most slowRetries times", async () => {
  // A slow fail means busy_timeout already burned (the holder runs a long
  // transaction), so each extra retry multiplies request latency by ~5s.
  // The attempt burns >= fastFailMs of wall time to classify as slow.
  const attemptsFor = async (slowRetries: number): Promise<number> => {
    let attempts = 0;
    try {
      await withBusyRetry(async () => {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw busyError();
      }, {
        maxAttempts: 10,
        slowRetries,
        fastFailMs: 10,
        backoffMs: 1,
        sleep: () => {},
      });
    } catch {
      // expected: busy error eventually rethrown
    }
    return attempts;
  };
  assert.equal(await attemptsFor(0), 1, "slowRetries=0: no retry after a slow fail");
  assert.equal(await attemptsFor(1), 2, "slowRetries=1: exactly one extra attempt");
});

test("withBusyRetry spends the slow budget once but keeps fast retries", async () => {
  let attempts = 0;
  const result = await withBusyRetry(async () => {
    attempts++;
    if (attempts === 1) throw busyError(); // fast fail
    if (attempts === 2) {
      await new Promise((resolve) => setTimeout(resolve, 15)); // slow fail
      throw busyError();
    }
    return "ok";
  }, {
    maxAttempts: 5,
    slowRetries: 1,
    fastFailMs: 10,
    backoffMs: 1,
    sleep: () => {},
  });
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("withBusyRetrySync retries via injected sleepSync without real waiting", () => {
  const sleeps: number[] = [];
  let attempts = 0;
  const result = withBusyRetrySync(() => {
    attempts++;
    if (attempts < 3) throw busyError();
    return 7;
  }, {
    maxAttempts: 4,
    backoffMs: 5,
    backoffMaxMs: 8,
    fastFailMs: 1000,
    sleepSync: (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(result, 7);
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [5, 8]);
});

test("withBusyRetrySync rethrows non-busy errors immediately", () => {
  let attempts = 0;
  assert.throws(
    () =>
      withBusyRetrySync(() => {
        attempts++;
        throw new Error("no such table");
      }, { maxAttempts: 5, backoffMs: 1, sleepSync: () => {} }),
    /no such table/
  );
  assert.equal(attempts, 1);
});

test("remember succeeds once another connection releases its write lock", async () => {
  // Two DatabaseSync handles on one file behave like two processes: SQLite
  // locking is per-connection. The "other process" holds BEGIN IMMEDIATE,
  // then releases while the backend is between retry attempts.
  const dir = mkdtempSync(join(tmpdir(), "ltm-busy-"));
  const dbPath = join(dir, "t.sqlite");
  try {
    const backend = new SqliteBackend(dbPath, {
      busyTimeoutMs: 40,
      busyRetry: {
        maxAttempts: 6,
        backoffMs: 25,
        backoffMaxMs: 50,
        fastFailMs: 20,
        slowRetries: 2,
      },
    });
    try {
      const holder = new DatabaseSync(dbPath);
      holder.exec("BEGIN IMMEDIATE");
      // Materialize the write lock so the backend's writes really conflict.
      holder.exec("CREATE TABLE IF NOT EXISTS busy_probe (x)");
      // Release while the backend backtracks through its retry attempts.
      setTimeout(() => {
        try {
          holder.exec("COMMIT");
        } catch {
          // already committed
        }
      }, 60);
      try {
        const r = await backend.remember({
          projectId: "proj_busy",
          content: "written after the cross-connection lock was released",
        });
        assert.ok(r.id.startsWith("mem_"));
        const hits = await backend.recall({
          projectId: "proj_busy",
          query: "cross-connection lock",
          kinds: ["memory"],
        });
        assert.ok(hits.length >= 1);
      } finally {
        try {
          holder.exec("COMMIT");
        } catch {
          // already committed
        }
        holder.close();
      }
    } finally {
      await backend.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("constructor retries pragma/schema init while a connection holds the write lock", async () => {
  // `PRAGMA journal_mode = WAL` and the DDL below it fast-fail with
  // SQLITE_BUSY when another connection holds a write transaction. The
  // constructor path is synchronous, so the event loop cannot fire timers
  // while it runs — the injected sleepSync hook releases the lock instead.
  const dir = mkdtempSync(join(tmpdir(), "ltm-busy-init-"));
  const dbPath = join(dir, "t.sqlite");
  try {
    // Seed an existing WAL database so the constructor has real contention.
    const seed = new DatabaseSync(dbPath);
    seed.exec("PRAGMA journal_mode = WAL;");
    seed.close();

    const holder = new DatabaseSync(dbPath);
    holder.exec("BEGIN IMMEDIATE");
    holder.exec("CREATE TABLE IF NOT EXISTS busy_probe (x)");

    let released = false;
    const backend = new SqliteBackend(dbPath, {
      busyTimeoutMs: 20,
      busyRetry: {
        maxAttempts: 5,
        backoffMs: 1,
        backoffMaxMs: 2,
        fastFailMs: 10,
        slowRetries: 2,
        sleepSync: () => {
          if (!released) {
            released = true;
            holder.exec("COMMIT");
          }
        },
      },
    });
    assert.ok(released, "constructor should have retried after a busy failure");
    try {
      // The retry went through: schema is writable and usable.
      const r = await backend.remember({
        projectId: "proj_busy_init",
        content: "constructor survived a contended init",
      });
      assert.ok(r.id.startsWith("mem_"));
    } finally {
      // Close every handle (and await the async close) so Windows releases
      // the files before rmSync.
      await backend.close();
      holder.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
