import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MemoryBackend } from "./backend";
import { isNearDuplicate } from "./jaccard.ts";
import type {
  ForgetInput,
  MemoryType,
  ObserveInput,
  RecallHit,
  RecallInput,
  RememberInput,
} from "./types";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const SNIPPET_MAX = 240;
const TITLE_MAX = 80;
const NARRATIVE_MAX = 4000;
const CONTENT_MAX = 8000;
const OBSERVE_DEDUP_WINDOW_MS = 60_000;

/** Strip FTS5 operators; return space-joined quoted tokens for safe MATCH. */
export function sanitizeFtsQuery(q: string): string {
  if (!q || !q.trim()) return "";
  const cleaned = q
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ");
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t.replace(/"/g, "")}"`).join(" ");
}

/** Tokens shorter than 3 chars cannot be matched by the trigram tokenizer. */
function shortTokens(q: string): string[] {
  if (!q || !q.trim()) return [];
  const cleaned = q
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ");
  return cleaned.split(/\s+/).filter((t) => t.length > 0 && t.length < 3);
}

function newId(prefix: "mem" | "obs"): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}_${rand}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function titleFromContent(content: string): string {
  const line = content.split(/\r?\n/, 1)[0] ?? content;
  return line.length <= TITLE_MAX ? line : line.slice(0, TITLE_MAX);
}

function snippetOf(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= SNIPPET_MAX ? t : `${t.slice(0, SNIPPET_MAX)}…`;
}

function clampLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/** Truncate to `max` UTF-16 units; if the cut splits a surrogate pair, back off one. */
export function truncateContent(content: string, max: number): string {
  if (content.length <= max) return content;
  const cut = content.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    return cut.slice(0, -1);
  }
  return cut;
}

export class SqliteBackend implements MemoryBackend {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    // Set the busy timeout before journal_mode=WAL: the mode switch needs a
    // brief exclusive lock, so a concurrent writer can otherwise still throw
    // SQLITE_BUSY before the timeout is in place.
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        narrative TEXT NOT NULL,
        source_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_obs_project ON observations(project_id);
      -- dedup 查询(project_id, session_id, kind, title, created_at)在每次 observe 跑,
      -- 组合索引把单 session 窗口内的点查降到 O(log n),避免随项目观察数线性扫描。
      CREATE INDEX IF NOT EXISTS idx_obs_dedup
        ON observations(project_id, session_id, kind, title);

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        concepts_json TEXT,
        files_json TEXT,
        source_observation_ids_json TEXT,
        is_latest INTEGER NOT NULL,
        parent_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mem_project_latest
        ON memories(project_id, is_latest);

      CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
        id UNINDEXED,
        project_id UNINDEXED,
        title,
        narrative,
        tokenize = 'trigram'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id UNINDEXED,
        project_id UNINDEXED,
        title,
        content,
        tokenize = 'trigram'
      );
    `);
    this.migrateFtsIfNeeded();
  }

  /**
   * v0 -> v1: rebuild FTS tables with the trigram tokenizer.
   *
   * Tables created before CJK support used the default unicode61 tokenizer,
   * which cannot match CJK substrings at all. CREATE VIRTUAL TABLE IF NOT
   * EXISTS never rewrites an existing table, and the FTS5 'rebuild' command
   * cannot change a tokenizer (it only reindexes the table's own content), so
   * the only path is drop + recreate + repopulate from the base tables, which
   * are the authoritative copy. A regular FTS5 table stores its text inside
   * its shadow tables, so dropping it loses nothing memories/observations
   * does not already hold. Runs in a transaction and is guarded by
   * PRAGMA user_version (unused elsewhere in this project).
   */
  private migrateFtsIfNeeded(): void {
    const row = this.db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (row.user_version >= 1) return;
    this.db.exec("BEGIN");
    try {
      this.db.exec("DROP TABLE IF EXISTS memories_fts;");
      this.db.exec(`
        CREATE VIRTUAL TABLE memories_fts USING fts5(
          id UNINDEXED, project_id UNINDEXED, title, content,
          tokenize = 'trigram'
        );
      `);
      this.db.exec(`
        INSERT INTO memories_fts(id, project_id, title, content)
        SELECT id, project_id, title, content FROM memories;
      `);
      this.db.exec("DROP TABLE IF EXISTS observations_fts;");
      this.db.exec(`
        CREATE VIRTUAL TABLE observations_fts USING fts5(
          id UNINDEXED, project_id UNINDEXED, title, narrative,
          tokenize = 'trigram'
        );
      `);
      this.db.exec(`
        INSERT INTO observations_fts(id, project_id, title, narrative)
        SELECT id, project_id, title, narrative FROM observations;
      `);
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch (rollbackErr) {
        console.error(
          "LTM: ROLLBACK failed after FTS migration error",
          rollbackErr
        );
      }
      throw err;
    }
    this.db.exec("PRAGMA user_version = 1;");
  }

  async remember(
    input: RememberInput
  ): Promise<{ id: string; type: MemoryType }> {
    const type: MemoryType = input.type ?? "fact";
    const content = truncateContent(input.content, CONTENT_MAX);
    const title = titleFromContent(content);
    const now = nowIso();
    const id = newId("mem");

    // Supersede UPDATE + new-row INSERT must be atomic: a crash between them
    // would leave the old memory un-latest with no replacement row.
    this.db.exec("BEGIN");
    try {
      let parentId: string | null = null;
      const latest = this.db
        .prepare(
          `SELECT id, content FROM memories
           WHERE project_id = ? AND is_latest = 1`
        )
        .all(input.projectId) as Array<{ id: string; content: string }>;

      for (const row of latest) {
        if (isNearDuplicate(content, row.content)) {
          parentId = row.id;
          this.db
            .prepare(
              `UPDATE memories SET is_latest = 0, updated_at = ? WHERE id = ?`
            )
            .run(now, row.id);
          // One supersede parent is enough; first high match wins.
          break;
        }
      }

      this.db
        .prepare(
          `INSERT INTO memories (
            id, project_id, type, title, content,
            concepts_json, files_json, source_observation_ids_json,
            is_latest, parent_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
        )
        .run(
          id,
          input.projectId,
          type,
          title,
          content,
          input.concepts ? JSON.stringify(input.concepts) : null,
          input.files ? JSON.stringify(input.files) : null,
          input.sourceObservationIds
            ? JSON.stringify(input.sourceObservationIds)
            : null,
          parentId,
          now,
          now
        );

      this.db
        .prepare(
          `INSERT INTO memories_fts(id, project_id, title, content)
           VALUES (?, ?, ?, ?)`
        )
        .run(id, input.projectId, title, content);

      this.db.exec("COMMIT");
    } catch (err) {
      // A failed ROLLBACK (e.g. SQLITE_BUSY on a concurrent write) must not
      // mask the original error that triggered this catch, nor leave the
      // catch branch itself throwing.
      try {
        this.db.exec("ROLLBACK");
      } catch (rollbackErr) {
        console.error("LTM: ROLLBACK failed after remember error", rollbackErr);
      }
      throw err;
    }

    return { id, type };
  }

  async recall(input: RecallInput): Promise<RecallHit[]> {
    const match = sanitizeFtsQuery(input.query);
    if (!match) return [];

    const limit = clampLimit(input.limit);
    const kinds = input.kinds ?? ["memory", "observation"];
    const wantMemory = kinds.includes("memory");
    const wantObs = kinds.includes("observation");
    const hits: RecallHit[] = [];

    if (wantMemory) {
      const rows = this.db
        .prepare(
          `SELECT m.id, m.title, m.content, m.type, m.created_at,
                  bm25(memories_fts) AS rank
           FROM memories_fts
           JOIN memories m ON m.id = memories_fts.id
           WHERE memories_fts MATCH ?
             AND m.project_id = ?
             AND m.is_latest = 1
           ORDER BY rank
           LIMIT ?`
        )
        .all(match, input.projectId, limit) as Array<{
        id: string;
        title: string;
        content: string;
        type: MemoryType;
        created_at: string;
        rank: number;
      }>;

      for (const r of rows) {
        hits.push({
          kind: "memory",
          id: r.id,
          title: r.title,
          snippet: snippetOf(r.content),
          score: -r.rank,
          type: r.type,
          createdAt: r.created_at,
        });
      }
    }

    if (wantObs) {
      const rows = this.db
        .prepare(
          `SELECT o.id, o.title, o.narrative, o.kind, o.created_at,
                  bm25(observations_fts) AS rank
           FROM observations_fts
           JOIN observations o ON o.id = observations_fts.id
           WHERE observations_fts MATCH ?
             AND o.project_id = ?
           ORDER BY rank
           LIMIT ?`
        )
        .all(match, input.projectId, limit) as Array<{
        id: string;
        title: string;
        narrative: string;
        kind: string;
        created_at: string;
        rank: number;
      }>;

      for (const r of rows) {
        hits.push({
          kind: "observation",
          id: r.id,
          title: r.title,
          snippet: snippetOf(r.narrative),
          score: -r.rank,
          type: r.kind as RecallHit["type"],
          createdAt: r.created_at,
        });
      }
    }

    // Trigram MATCH needs >= 3 characters per token, so 1-2 char CJK lookups
    // ("记忆", "压缩") return nothing from FTS. Fall back to a per-token LIKE
    // scan (not whole-query: multi-token queries are rarely contiguous in the
    // text) — project-scoped, per-project row counts are small. LIKE hits get
    // score 0 so FTS hits (bm25 > 0) rank above them.
    const shortToks = shortTokens(input.query);
    if (shortToks.length > 0) {
      const seen = new Set(hits.map((h) => h.id));
      if (wantMemory) {
        for (const tok of shortToks) {
          const rows = this.db
            .prepare(
              `SELECT id, title, content, type, created_at FROM memories
               WHERE project_id = ? AND is_latest = 1
                 AND (title LIKE ? OR content LIKE ?)
               LIMIT ?`
            )
            .all(
              input.projectId,
              `%${tok}%`,
              `%${tok}%`,
              limit
            ) as Array<{
            id: string;
            title: string;
            content: string;
            type: MemoryType;
            created_at: string;
          }>;
          for (const r of rows) {
            if (seen.has(r.id)) continue;
            seen.add(r.id);
            hits.push({
              kind: "memory",
              id: r.id,
              title: r.title,
              snippet: snippetOf(r.content),
              score: 0,
              type: r.type,
              createdAt: r.created_at,
            });
          }
        }
      }
      if (wantObs) {
        for (const tok of shortToks) {
          const rows = this.db
            .prepare(
              `SELECT id, title, narrative, kind, created_at FROM observations
               WHERE project_id = ?
                 AND (title LIKE ? OR narrative LIKE ?)
               LIMIT ?`
            )
            .all(input.projectId, `%${tok}%`, `%${tok}%`, limit) as Array<{
            id: string;
            title: string;
            narrative: string;
            kind: string;
            created_at: string;
          }>;
          for (const r of rows) {
            if (seen.has(r.id)) continue;
            seen.add(r.id);
            hits.push({
              kind: "observation",
              id: r.id,
              title: r.title,
              snippet: snippetOf(r.narrative),
              score: 0,
              type: r.kind as RecallHit["type"],
              createdAt: r.created_at,
            });
          }
        }
      }
    }

    hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return hits.slice(0, limit);
  }

  async observe(
    input: ObserveInput
  ): Promise<{ observationId: string } | { deduplicated: true }> {
    // Drop repeated observations of the same project/session/kind/title within
    // a short window (e.g. the same agent_end firing twice) so one session does
    // not accumulate duplicate rows. The dedup key intentionally ignores the
    // narrative — only the identity of the observation matters.
    const dedupCutoff = new Date(
      Date.now() - OBSERVE_DEDUP_WINDOW_MS
    ).toISOString();
    const existing = this.db
      .prepare(
        `SELECT id FROM observations
         WHERE project_id = ? AND session_id = ? AND kind = ? AND title = ?
           AND created_at >= ?
         LIMIT 1`
      )
      .get(
        input.projectId,
        input.sessionId,
        input.kind,
        input.title,
        dedupCutoff
      );
    if (existing) {
      return { deduplicated: true };
    }

    const id = newId("obs");
    const narrative =
      input.narrative.length > NARRATIVE_MAX
        ? input.narrative.slice(0, NARRATIVE_MAX)
        : input.narrative;
    const createdAt = nowIso();
    const sourceJson =
      input.source === undefined ? null : JSON.stringify(input.source);

    this.db
      .prepare(
        `INSERT INTO observations (
          id, project_id, session_id, kind, title, narrative, source_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.projectId,
        input.sessionId,
        input.kind,
        input.title,
        narrative,
        sourceJson,
        createdAt
      );

    this.db
      .prepare(
        `INSERT INTO observations_fts(id, project_id, title, narrative)
         VALUES (?, ?, ?, ?)`
      )
      .run(id, input.projectId, input.title, narrative);

    return { observationId: id };
  }

  async forget(input: ForgetInput): Promise<{ deleted: number }> {
    let deleted = 0;

    if (input.memoryIds?.length) {
      const getRow = this.db.prepare(
        `SELECT is_latest, parent_id FROM memories WHERE id = ? AND project_id = ?`
      );
      const delMem = this.db.prepare(
        `DELETE FROM memories WHERE id = ? AND project_id = ?`
      );
      const delMemFts = this.db.prepare(`DELETE FROM memories_fts WHERE id = ?`);
      const setLatest = this.db.prepare(
        `UPDATE memories SET is_latest = 1 WHERE id = ? AND project_id = ?`
      );
      for (const id of input.memoryIds) {
        const row = getRow.get(id, input.projectId) as
          | { is_latest: number; parent_id: string | null }
          | undefined;
        const result = delMem.run(id, input.projectId) as { changes: number };
        if (result.changes > 0) {
          delMemFts.run(id);
          deleted += result.changes;
          // Deleting a latest memory strands every superseded version in its
          // parent chain as is_latest=0, invisible to recall. Promote the
          // newest remaining version (the direct parent, since each new
          // version supersedes the previous) back to latest so one version
          // always stays visible. No parent means no versions remain.
          if (row && row.is_latest === 1 && row.parent_id) {
            setLatest.run(row.parent_id, input.projectId);
          }
        }
      }
    }

    if (input.observationIds?.length) {
      const delObs = this.db.prepare(
        `DELETE FROM observations WHERE id = ? AND project_id = ?`
      );
      const delObsFts = this.db.prepare(
        `DELETE FROM observations_fts WHERE id = ?`
      );
      for (const id of input.observationIds) {
        const result = delObs.run(id, input.projectId) as { changes: number };
        if (result.changes > 0) {
          delObsFts.run(id);
          deleted += result.changes;
        }
      }
    }

    return { deleted };
  }

  async health(): Promise<{ ok: boolean; backend: string; detail?: string }> {
    try {
      this.db.prepare("SELECT 1").get();
      return { ok: true, backend: "sqlite" };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, backend: "sqlite", detail };
    }
  }

  /** Debug / API stats: latest memories + all observations for a project. */
  async stats(
    projectId: string
  ): Promise<{ memoryCount: number; observationCount: number }> {
    const mem = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM memories
         WHERE project_id = ? AND is_latest = 1`
      )
      .get(projectId) as { c: number };
    const obs = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM observations WHERE project_id = ?`
      )
      .get(projectId) as { c: number };
    return {
      memoryCount: Number(mem.c),
      observationCount: Number(obs.c),
    };
  }

  async close(): Promise<void> {
    try {
      // Fold the WAL into the main DB file so the on-disk database is
      // self-contained (recent writes are not left stranded in the -wal file).
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (err) {
      // Close is best-effort: a failed checkpoint must not block releasing the
      // handle, and must not throw out of close().
      console.error("LTM: wal_checkpoint failed on close", err);
    }
    this.db.close();
  }
}
