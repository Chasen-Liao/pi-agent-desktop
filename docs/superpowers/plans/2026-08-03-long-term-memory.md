# Long-Term Memory (LTM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship project-scoped long-term memory (SQLite + FTS) with tools and API, automatic observe on agent_end and pre-compact, without changing session JSONL.

**Architecture:** `MemoryService` facade over `MemoryBackend`; phase-1 `SqliteBackend` via Node built-in `node:sqlite` (`DatabaseSync` + FTS5); `AgentMemoryRestBackend` stub; hooks in rpc-manager / event path; tools via Pi inline extension.

**Tech Stack:** TypeScript, Next.js App Router, `node:test` + `node:assert/strict`, `node:sqlite` (Node 24 / Electron host Node — no better-sqlite3), existing `desktop-settings` pattern.

**Spec:** [docs/superpowers/specs/2026-08-03-long-term-memory-design.md](../specs/2026-08-03-long-term-memory-design.md)  
**Branch:** `feature/long-term-memory`

## Global Constraints

- Do **not** change Pi JSONL schema or cold-read `session-reader` as LTM store.
- LTM failures must be **best-effort** (never fail prompt/compact/UI).
- Tools/API/hooks call **only** `MemoryService`, never SQL.
- `projectId` = `proj_` + first 16 hex of sha256(normalized absolute cwd); Windows lowercase.
- Observe kinds v1: `agent_end` | `pre_compact` only.
- No system-prompt inject; no Memory UI panel.
- Storage default: `{agentDir}/memory/ltm.sqlite` i.e. under `getAgentDir()`.
- Tests: `node --test` with `*.test.ts`; no new npm deps if `node:sqlite` works (verified on Node 24).
- Prefer small pure functions + temp DB files under `os.tmpdir()`.
- Match existing code style: ESM `.ts` imports with `.ts` suffix where the repo already does.

## File map

| Path | Role |
|------|------|
| `lib/ltm/types.ts` | Domain types |
| `lib/ltm/project-id.ts` | `projectIdFromCwd` |
| `lib/ltm/jaccard.ts` | Token Jaccard for supersede |
| `lib/ltm/backend.ts` | `MemoryBackend` interface |
| `lib/ltm/sqlite-backend.ts` | SQLite + FTS5 |
| `lib/ltm/agentmemory-backend.ts` | Stub |
| `lib/ltm/config.ts` | Read LTM settings from desktop-settings / defaults |
| `lib/ltm/service.ts` | Facade + `globalThis` singleton |
| `lib/ltm/observe-payload.ts` | Build agent_end / pre_compact payloads |
| `lib/ltm/index.ts` | Public exports |
| `lib/ltm/*.test.ts` | Unit tests |
| `lib/desktop-ltm-extension.ts` | Inline extension: memory_* tools |
| `lib/desktop-settings.ts` | Extend settings with LTM fields |
| `lib/rpc-manager.ts` | Wire extension, pre_compact, agent_end observe |
| `app/api/memory/health/route.ts` | GET health |
| `app/api/memory/recall/route.ts` | GET recall |
| `app/api/memory/remember/route.ts` | POST remember |
| `app/api/memory/forget/route.ts` | POST forget |
| `app/api/memory/stats/route.ts` | GET stats |
| `app/api/memory/routes.test.ts` | API tests (handler-level if possible) |

---

### Task 1: projectId + Jaccard pure helpers

**Files:**
- Create: `lib/ltm/project-id.ts`
- Create: `lib/ltm/jaccard.ts`
- Create: `lib/ltm/project-id.test.ts`
- Create: `lib/ltm/jaccard.test.ts`

**Interfaces:**
- Produces: `projectIdFromCwd(cwd: string): string`
- Produces: `jaccardSimilarity(a: string, b: string): number` (0..1)

- [ ] **Step 1: Write failing tests**

```ts
// lib/ltm/project-id.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { projectIdFromCwd } from "./project-id.ts";

test("projectIdFromCwd is stable for same absolute path", () => {
  const a = projectIdFromCwd(process.cwd());
  const b = projectIdFromCwd(process.cwd());
  assert.equal(a, b);
  assert.match(a, /^proj_[0-9a-f]{16}$/);
});

test("projectIdFromCwd rejects empty cwd", () => {
  assert.throws(() => projectIdFromCwd("   "), /cwd/i);
});
```

```ts
// lib/ltm/jaccard.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { jaccardSimilarity } from "./jaccard.ts";

test("identical multi-word strings score 1", () => {
  assert.equal(jaccardSimilarity("prefer dark mode theme", "prefer dark mode theme"), 1);
});

test("disjoint strings score 0", () => {
  assert.equal(jaccardSimilarity("alpha beta gamma", "delta epsilon zeta"), 0);
});

test("high overlap exceeds 0.7", () => {
  const s = jaccardSimilarity(
    "use path resolve for session root directory layout",
    "use path resolve for session root directory layout please"
  );
  assert.ok(s > 0.7);
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
node --test --test-force-exit lib/ltm/project-id.test.ts lib/ltm/jaccard.test.ts
```

- [ ] **Step 3: Implement**

```ts
// lib/ltm/project-id.ts
import { createHash } from "node:crypto";
import path from "node:path";

export function projectIdFromCwd(cwd: string): string {
  if (typeof cwd !== "string" || !cwd.trim()) {
    throw new Error("cwd is required for projectId");
  }
  const resolved = path.resolve(cwd.trim());
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const hex = createHash("sha256").update(key, "utf8").digest("hex");
  return `proj_${hex.slice(0, 16)}`;
}
```

```ts
// lib/ltm/jaccard.ts
/** Whitespace tokens, drop length <= 2 (ASCII-oriented v1). */
export function jaccardSimilarity(a: string, b: string): number {
  const na = a.normalize("NFC").toLowerCase();
  const nb = b.normalize("NFC").toLowerCase();
  const setA = tokens(na);
  const setB = tokens(nb);
  if (setA.size === 0 || setB.size === 0) {
    return na.trim().replace(/\s+/g, " ") === nb.trim().replace(/\s+/g, " ") ? 1 : 0;
  }
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / (setA.size + setB.size - inter);
}

function tokens(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter((t) => t.length > 2));
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --test --test-force-exit lib/ltm/project-id.test.ts lib/ltm/jaccard.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/ltm/project-id.ts lib/ltm/jaccard.ts lib/ltm/project-id.test.ts lib/ltm/jaccard.test.ts
git commit -m "feat(ltm): add projectId and Jaccard helpers"
```

---

### Task 2: Domain types + MemoryBackend interface

**Files:**
- Create: `lib/ltm/types.ts`
- Create: `lib/ltm/backend.ts`

**Interfaces:**
- Produces: types and `MemoryBackend` as in spec §5–6 (copy signatures exactly from spec section 6).

- [ ] **Step 1: Add `types.ts` and `backend.ts`** with exports matching the design doc §6 (`RememberInput`, `RecallInput`, `ObserveInput`, `ForgetInput`, `RecallHit`, `MemoryBackend`, `MemoryType`, `ObserveKind`).

- [ ] **Step 2: Commit**

```bash
git add lib/ltm/types.ts lib/ltm/backend.ts
git commit -m "feat(ltm): add domain types and MemoryBackend interface"
```

---

### Task 3: SqliteBackend + FTS

**Files:**
- Create: `lib/ltm/sqlite-backend.ts`
- Create: `lib/ltm/sqlite-backend.test.ts`

**Interfaces:**
- Consumes: `MemoryBackend`, `jaccardSimilarity`, types
- Produces: `class SqliteBackend implements MemoryBackend` with constructor `(dbPath: string)`
- Uses `node:sqlite` `DatabaseSync`
- Schema: tables `observations`, `memories`; FTS5 `observations_fts`, `memories_fts` with external content or simple content tables (prefer **content=** sync triggers or dual-write insert into FTS on write — pick dual-write insert/delete for simplicity)

**Requirements:**
- `remember`: supersede if latest same project Jaccard > 0.7
- `recall`: FTS MATCH on memories and observations; merge by score; respect `kinds` and `limit`
- `observe`: insert row + FTS
- `forget`: delete by ids scoped to `projectId`
- `health`: `{ ok: true, backend: "sqlite" }`
- Create parent dir of `dbPath` if missing
- Escape FTS query: strip characters that break MATCH (e.g. keep alphanumerics and spaces; quote tokens) — implement `sanitizeFtsQuery(q: string): string` in same file or `fts-query.ts`

- [ ] **Step 1: Write failing integration tests** using a temp file:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteBackend } from "./sqlite-backend.ts";

test("remember and recall within project", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ltm-"));
  const backend = new SqliteBackend(join(dir, "t.sqlite"));
  try {
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
  } finally {
    await backend.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recall does not leak across projects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ltm-"));
  const backend = new SqliteBackend(join(dir, "t.sqlite"));
  try {
    await backend.remember({ projectId: "proj_a", content: "unique zebra widget convention" });
    const hits = await backend.recall({ projectId: "proj_b", query: "zebra widget", limit: 5 });
    assert.equal(hits.length, 0);
  } finally {
    await backend.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("observe agent_end is recallable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ltm-"));
  const backend = new SqliteBackend(join(dir, "t.sqlite"));
  try {
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
  } finally {
    await backend.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test --test-force-exit lib/ltm/sqlite-backend.test.ts
```

- [ ] **Step 3: Implement `SqliteBackend`** with schema init on construct, all interface methods.

- [ ] **Step 4: Run — expect PASS**

```bash
node --test --test-force-exit lib/ltm/sqlite-backend.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/ltm/sqlite-backend.ts lib/ltm/sqlite-backend.test.ts
git commit -m "feat(ltm): SQLite backend with FTS recall"
```

---

### Task 4: Config + Service singleton + stub backend

**Files:**
- Create: `lib/ltm/config.ts`
- Create: `lib/ltm/agentmemory-backend.ts`
- Create: `lib/ltm/service.ts`
- Create: `lib/ltm/service.test.ts`
- Create: `lib/ltm/index.ts`
- Modify: `lib/desktop-settings.ts` (+ tests in `lib/desktop-settings.test.ts` if present, else extend)

**Interfaces:**
- Produces:
  - `getLtmConfig(agentDir: string): LtmConfig`
  - `getMemoryService(agentDir?: string): MemoryService`
  - `MemoryService` methods: `rememberFromCwd`, `recallFromCwd`, `observeFromCwd`, `forgetFromCwd`, `health`, `isEnabled`
- `LtmConfig`: `{ enabled, backend: "sqlite"|"agentmemory", dbPath, observeAgentEnd, observePreCompact, agentmemoryUrl }`
- Defaults per spec §11; `dbPath` default `join(agentDir, "memory", "ltm.sqlite")`
- Extend `DesktopSettings` with optional nested `ltm?: Partial<LtmConfig fields without dbPath computed>` OR flat keys — **prefer nested `ltm` object** merged in `mergeDesktopSettings`
- `AgentMemoryRestBackend`: every method throws `Error("agentmemory backend not implemented in v1")` except `health` → `{ ok: false, backend: "agentmemory", detail: "not_implemented" }`
- Service: if `!enabled`, methods throw or return structured; for observe hooks use `safeObserve` that no-ops when disabled
- Store service on `globalThis.__piLtmService` keyed by dbPath or single instance

- [ ] **Step 1: Tests for config defaults + service remember/recall via temp agentDir**

```ts
// service.test.ts outline
test("getMemoryService remember/recall with temp agentDir", async () => {
  // set agentDir via constructor injection: prefer MemoryService.create(config) for testability
});
```

**Design note for implementer:** expose `MemoryService.create(config: LtmConfig)` for tests and `getMemoryService()` for production that reads settings + `getAgentDir()` from pi-coding-agent.

- [ ] **Step 2: Implement config, stub, service, index exports**

- [ ] **Step 3: Run tests**

```bash
node --test --test-force-exit lib/ltm/service.test.ts lib/desktop-settings.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add lib/ltm/config.ts lib/ltm/agentmemory-backend.ts lib/ltm/service.ts lib/ltm/service.test.ts lib/ltm/index.ts lib/desktop-settings.ts lib/desktop-settings.test.ts
git commit -m "feat(ltm): MemoryService facade, config, agentmemory stub"
```

---

### Task 5: Observe payload builders

**Files:**
- Create: `lib/ltm/observe-payload.ts`
- Create: `lib/ltm/observe-payload.test.ts`

**Interfaces:**
- Produces:
  - `buildAgentEndObservation(input: { userText: string; assistantText: string }): { title: string; narrative: string }`
  - `buildPreCompactObservation(input: { messagesText: string }): { title: string; narrative: string }`
- Truncation: title 80 chars; user 500; assistant 4000; pre_compact body 6000
- Empty strings → still valid short placeholders (`"(empty)"`)

- [ ] **Step 1: Write tests for truncation and title extraction**

- [ ] **Step 2: Implement**

- [ ] **Step 3: Pass tests + commit**

```bash
git add lib/ltm/observe-payload.ts lib/ltm/observe-payload.test.ts
git commit -m "feat(ltm): observe payload builders"
```

---

### Task 6: HTTP API routes

**Files:**
- Create: `app/api/memory/health/route.ts`
- Create: `app/api/memory/recall/route.ts`
- Create: `app/api/memory/remember/route.ts`
- Create: `app/api/memory/forget/route.ts`
- Create: `app/api/memory/stats/route.ts`
- Create: `app/api/memory/routes.test.ts` — test pure request parsers / or import handlers if exportable

**Pattern:** Follow existing API routes (`getRequestId`, `logApiError`, JSON responses). Use `getMemoryService()` server-side.

| Route | Behavior |
|-------|----------|
| GET health | service.health(); if disabled include enabled:false |
| GET recall | require `cwd` + `q` query params |
| POST remember | JSON `{ cwd, content, type?, concepts?, files? }` |
| POST forget | JSON `{ cwd, memoryIds?, observationIds? }` |
| GET stats | count for project (implement `stats(projectId)` on service/sqlite if missing — add method) |

If LTM disabled: **503** `{ error: "ltm_disabled" }`.

- [ ] **Step 1: Add `stats` to backend/service if not present** (small method: `SELECT COUNT(*)` for memories/observations by project).

- [ ] **Step 2: Implement routes**

- [ ] **Step 3: Unit-test validation helpers** (extract `parseRecallQuery(url)` to `lib/ltm/http.ts` if cleaner for testing without Next request machinery)

- [ ] **Step 4: Commit**

```bash
git add app/api/memory lib/ltm/http.ts lib/ltm/http.test.ts
git commit -m "feat(ltm): HTTP API for recall/remember/forget/health/stats"
```

---

### Task 7: Wire pre_compact observe in rpc-manager

**Files:**
- Modify: `lib/rpc-manager.ts` (`case "compact"`)
- Create: `lib/ltm/compact-observe.test.ts` — unit test a extracted function rather than full wrapper if needed

**Logic:**

```ts
// Before await this.inner.compact(...)
// After the "too short" throw check
void safeLtmPreCompactObserve({
  sessionId: this.sessionId,
  cwd: this.inner.sessionManager.getHeader()?.cwd ?? process.cwd(),
  // branch text: join recent message contents from getBranch() message entries
});
```

Implement `safeLtmPreCompactObserve` in `lib/ltm/observe-hooks.ts`:
- try/catch all
- if !config.observePreCompact or !enabled return
- build text from provided string
- call service.observeFromCwd

- [ ] **Step 1: Extract branch messages → string helper + test**

- [ ] **Step 2: Call from compact case**

- [ ] **Step 3: Manual sanity: unit test helper; optional mock service

- [ ] **Step 4: Commit**

```bash
git add lib/rpc-manager.ts lib/ltm/observe-hooks.ts lib/ltm/observe-hooks.test.ts
git commit -m "feat(ltm): pre-compact observation hook"
```

---

### Task 8: Wire agent_end observe

**Files:**
- Modify: `lib/rpc-manager.ts` `start()` subscribe handler
- Modify: `lib/ltm/observe-hooks.ts`

**Logic:** On inner event where `event.type === "agent_end"` (or settled equivalent used by pi — verify against `AgentSessionEvent` types in pi package):

```ts
void safeLtmAgentEndObserve({
  sessionId: this.sessionId,
  cwd: header.cwd,
  userText: lastUserFromBranch(...),
  assistantText: lastAssistantFromBranch(...),
});
```

If event payload already includes messages, prefer that; else read `sessionManager.getBranch()` message entries.

- [ ] **Step 1: Confirm event type name** from `@earendil-works/pi-coding-agent` / existing SSE mapping in `agent-events-manager.ts` (`agent_end`).

- [ ] **Step 2: Implement safe hook + wire in subscribe**

- [ ] **Step 3: Test payload path with pure helpers (already in observe-payload); hook wrapper try/catch unit test

- [ ] **Step 4: Commit**

```bash
git add lib/rpc-manager.ts lib/ltm/observe-hooks.ts lib/ltm/observe-hooks.test.ts
git commit -m "feat(ltm): agent_end observation hook"
```

---

### Task 9: memory_* tools via inline extension

**Files:**
- Create: `lib/desktop-ltm-extension.ts`
- Create: `lib/desktop-ltm-extension.test.ts` (factory registers tool names — shallow test)
- Modify: `lib/rpc-manager.ts` `startRpcSession` `extensionFactories: [desktopApprovalInlineExtension(modeRef), desktopLtmInlineExtension({ getCwd: () => cwd })]`

**Tools (TypeBox or project’s existing schema style — match pi ToolDefinition):**

| name | parameters | behavior |
|------|------------|----------|
| `memory_save` | content (required), type optional | service.rememberFromCwd(cwd, …) |
| `memory_recall` | query, limit? | service.recallFromCwd |
| `memory_forget` | memoryIds?: string[] | service.forgetFromCwd |

When LTM disabled, tools can still register but execute returns text error "Long-term memory is disabled".

**Important:** Tools must not require ask-mode confirm (they are not bash/write/edit).

- [ ] **Step 1: Implement extension factory**

- [ ] **Step 2: Register in startRpcSession**

- [ ] **Step 3: Surface test that source includes `desktopLtmInlineExtension` (pattern like `rpc-manager.test.ts` source scans) OR unit-test factory with mock ExtensionAPI

- [ ] **Step 4: Commit**

```bash
git add lib/desktop-ltm-extension.ts lib/desktop-ltm-extension.test.ts lib/rpc-manager.ts lib/rpc-manager.test.ts
git commit -m "feat(ltm): register memory_save/recall/forget tools"
```

---

### Task 10: Docs + smoke checklist

**Files:**
- Modify: `docs/memory-architecture.html` — add short section linking to LTM spec and noting LTM layer
- Optional one-line in `AGENTS.md` under architecture: LTM at `lib/ltm`, API `/api/memory/*`

- [ ] **Step 1: Link docs**

- [ ] **Step 2: Run full test suite**

```bash
npm run test
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add docs/memory-architecture.html docs/superpowers/specs/2026-08-03-long-term-memory-design.md docs/superpowers/plans/2026-08-03-long-term-memory.md AGENTS.md
git commit -m "docs(ltm): link long-term memory architecture and plan"
```

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| MemoryBackend + SQLite FTS | 2, 3 |
| projectId cwd hash | 1 |
| remember + supersede | 3, 4 |
| recall tools only | 9 |
| observe agent_end | 8 |
| observe pre_compact | 7 |
| API routes | 6 |
| agentmemory stub | 4 |
| config flags | 4 |
| no JSONL change | (global) |
| globalThis service | 4 |
| tests | 1–9 |
| node:sqlite driver | 3 (verified) |

## Self-review notes

- No TBD placeholders in tasks.  
- SQLite driver fixed to `node:sqlite` (no new dependency).  
- Tool registration uses proven `extensionFactories` pattern.  
- Stats method added in Task 6 if not in Task 3 — implementers should add `stats` on backend in Task 3 or 6 consistently (`stats(projectId): Promise<{ memoryCount: number; observationCount: number }>`).

**Recommended:** implement `stats` on `MemoryBackend` in **Task 3** so Task 6 only wires HTTP.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-03-long-term-memory.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session, executing-plans with checkpoints  

**Which approach?**
