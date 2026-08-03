# Long-Term Memory (LTM) Design

**Date:** 2026-08-03  
**Branch:** `feature/long-term-memory`  
**Status:** Approved for implementation planning  
**Related:** [docs/memory-architecture.html](../../memory-architecture.html) (session memory baseline)

## 1. Summary

Add a **project-scoped long-term memory layer** beside the existing Pi session JSONL (episodic log). Architecture is **pluggable backends** behind a single service interface. Phase 1 implements **built-in SQLite** only; an **agentmemory REST** adapter is stubbed for later.

Session files, cold-read paths, and Pi `SessionManager` contracts are **not** modified as the primary store.

## 2. Decisions (locked)

| Topic | Choice |
|-------|--------|
| Architecture | **C**: `MemoryBackend` interface + swappable adapters |
| Phase-1 backend | **SQLite** (built-in) |
| agentmemory REST | Interface + stub only; selecting it returns a clear "not implemented" error |
| `projectId` | Hash of normalized absolute `cwd` (Windows: resolve + lowercase) |
| Auto observe | **Turn boundary only**: `agent_end` + **pre-compact** |
| Into the model | **Tools only**: `memory_recall` / `memory_save` (optional `memory_forget`) |
| Auto inject system prompt | **No** in v1 |
| User-facing surface | Agent tools + `/api/memory/*`; **no** Memory sidebar UI |
| DB path | `~/.pi/agent/memory/ltm.sqlite` (override via settings) |

### Non-goals (v1)

- Vector / hybrid graph search, crystallize chains, full tool-trajectory logging  
- Default context injection on every prompt  
- Memory management UI  
- Depending on a running agentmemory / iii process  
- Changing `.jsonl` schema as the LTM source of truth  
- Multi-root project registry (cwd move = new `projectId` is accepted in v1)

## 3. Goals

1. Cross-session recall of durable facts and compact-safe observations for a project.  
2. Explicit save path aligned with agentmemory memory types.  
3. Automatic, zero-LLM capture at low-noise hooks (`agent_end`, pre-compact).  
4. Clean seam so a future agentmemory REST backend does not rewrite tools/API/hooks.  
5. Best-effort capture: LTM failures never block chat, compact, or tool UX.

## 4. Architecture

```
┌─────────────────────────────────────────────┐
│  Agent tools / HTTP /api/memory/*           │
└─────────────────────┬───────────────────────┘
                      ▼
┌─────────────────────────────────────────────┐
│  MemoryService (lib/ltm/service.ts)         │
│  - resolve projectId from cwd               │
│  - validate inputs                          │
│  - optional supersede / orchestration       │
└─────────────────────┬───────────────────────┘
                      │ MemoryBackend
          ┌───────────┴───────────┐
          ▼                       ▼
┌──────────────────┐    ┌──────────────────────────┐
│ SqliteBackend    │    │ AgentMemoryRestBackend   │
│ (phase 1)        │    │ (stub phase 1)           │
└────────┬─────────┘    └──────────────────────────┘
         ▼
 ~/.pi/agent/memory/ltm.sqlite
```

### Module layout

| Path | Responsibility |
|------|----------------|
| `lib/ltm/types.ts` | Domain types |
| `lib/ltm/project-id.ts` | Pure `projectIdFromCwd(cwd)` |
| `lib/ltm/backend.ts` | `MemoryBackend` interface |
| `lib/ltm/sqlite-backend.ts` | SQLite + FTS5 |
| `lib/ltm/agentmemory-backend.ts` | Stub |
| `lib/ltm/service.ts` | Facade; singleton on `globalThis` for HMR |
| `lib/ltm/observe-hooks.ts` | Build observe payloads from agent/compact context |
| `lib/ltm/index.ts` | Public exports |
| `app/api/memory/**` | HTTP routes |
| Tool registration | Via existing Pi tool / desktop extension mechanism |

**Rule:** hooks, routes, and tools call **only** `MemoryService`, never SQL or a concrete backend.

### Layer relationship to session memory

| Layer | Role after LTM |
|-------|----------------|
| L1 JSONL | Episodic session truth (unchanged) |
| L2 AgentSession | Hot execution; fire observe hooks best-effort |
| L3 UI | Unchanged for v1 (no memory panel) |
| **LTM store** | Project-scoped semantic/episodic index |

See baseline analysis: `docs/memory-architecture.html`.

## 5. Data model (SQLite)

### 5.1 `observations`

| Column | Type | Notes |
|--------|------|--------|
| `id` | TEXT PK | e.g. `obs_<ts>_<rand>` |
| `project_id` | TEXT NOT NULL | indexed |
| `session_id` | TEXT NOT NULL | Pi session id |
| `kind` | TEXT NOT NULL | `agent_end` \| `pre_compact` |
| `title` | TEXT NOT NULL | short |
| `narrative` | TEXT NOT NULL | searchable body (truncated, e.g. 4k chars) |
| `source_json` | TEXT | optional raw snippet JSON |
| `created_at` | TEXT NOT NULL | ISO-8601 |

### 5.2 `memories`

| Column | Type | Notes |
|--------|------|--------|
| `id` | TEXT PK | e.g. `mem_...` |
| `project_id` | TEXT NOT NULL | indexed |
| `type` | TEXT NOT NULL | `pattern` \| `preference` \| `architecture` \| `bug` \| `workflow` \| `fact` |
| `title` | TEXT NOT NULL | first ~80 chars of content |
| `content` | TEXT NOT NULL | |
| `concepts_json` | TEXT | optional JSON string array |
| `files_json` | TEXT | optional JSON string array |
| `source_observation_ids_json` | TEXT | optional |
| `is_latest` | INTEGER NOT NULL | 1/0 for supersede |
| `parent_id` | TEXT | previous version id |
| `created_at` / `updated_at` | TEXT | ISO-8601 |

Default `type` when omitted: `fact`.

### 5.3 FTS

- `memories_fts` over `title`, `content`  
- `observations_fts` over `title`, `narrative`  
- Phase 1 retrieval is **keyword/FTS only** (no embeddings).

### 5.4 `projectId`

```ts
function projectIdFromCwd(cwd: string): string {
  const resolved = path.resolve(cwd);
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  // sha256 hex, first 16 chars
  return `proj_${sha256(key).slice(0, 16)}`;
}
```

- Empty / invalid cwd → reject at service/API boundary (400).  
- Same directory after rename/move/drive letter change may yield a **new** project in v1 (accepted).

## 6. `MemoryBackend` interface

```ts
export type MemoryType =
  | "pattern"
  | "preference"
  | "architecture"
  | "bug"
  | "workflow"
  | "fact";

export type ObserveKind = "agent_end" | "pre_compact";

export interface RememberInput {
  projectId: string;
  content: string;
  type?: MemoryType;
  concepts?: string[];
  files?: string[];
  sourceObservationIds?: string[];
  sessionId?: string;
}

export interface RecallInput {
  projectId: string;
  query: string;
  limit?: number; // default 10, max 50
  kinds?: Array<"memory" | "observation">; // default both
}

export interface ObserveInput {
  projectId: string;
  sessionId: string;
  kind: ObserveKind;
  title: string;
  narrative: string;
  source?: unknown;
}

export interface ForgetInput {
  projectId: string;
  memoryIds?: string[];
  observationIds?: string[];
}

export interface RecallHit {
  kind: "memory" | "observation";
  id: string;
  title: string;
  snippet: string;
  score?: number;
  type?: MemoryType | ObserveKind;
  createdAt: string;
}

export interface MemoryBackend {
  remember(input: RememberInput): Promise<{ id: string; type: MemoryType }>;
  recall(input: RecallInput): Promise<RecallHit[]>;
  observe(
    input: ObserveInput
  ): Promise<{ observationId: string } | { deduplicated: true }>;
  forget(input: ForgetInput): Promise<{ deleted: number }>;
  health(): Promise<{ ok: boolean; backend: string; detail?: string }>;
  close?(): Promise<void>;
}
```

### Supersede

When saving a memory, if another **latest** memory in the **same `projectId`** has Jaccard token similarity **> 0.7** on content, mark the old one `is_latest = 0` and set `parent_id` on the new row (agentmemory-inspired). Prefer a pure helper for unit tests (CJK-aware optional later; v1 may use simple whitespace tokens with a documented limitation).

### Dedup (observe)

Optional short-window dedup for identical `sessionId + kind + title` hash; return `{ deduplicated: true }`. Not required for correctness.

## 7. Write paths

### 7.1 Explicit `memory_save`

1. Tool or `POST /api/memory/remember` with `cwd` + `content` (+ optional type/concepts/files).  
2. `MemoryService` → `projectIdFromCwd` → `backend.remember`.  
3. Update FTS.

### 7.2 Auto `agent_end` (zero-LLM)

**Hook site:** after a successful agent turn end is known server-side (prefer the same place that already drives session consistency — e.g. path that handles agent completion before/with reload). Implementation plan will pick the single most reliable event in `rpc-manager` / session event bridge.

**Payload (synthetic):**

- `kind: "agent_end"`  
- `title`: first line / 80 chars of last user prompt  
- `narrative`: `User: <truncated>\nAssistant: <truncated>` (e.g. user 500 / assistant 4000 chars)  
- `sessionId`, `projectId` from session cwd  

**Failure:** log and swallow; never fail the agent turn.

### 7.3 Auto `pre_compact` (zero-LLM)

**Hook site:** `AgentSessionWrapper.send` `case "compact"` — **before** `inner.compact(...)` (after the existing "too short" guard is fine so we do not observe empty compacts).

**Payload:**

- `kind: "pre_compact"`  
- `narrative`: text built from current branch path / recent messages about to be summarized (truncate)  
- purpose: preserve signal that compaction would otherwise hide from **context views** (raw JSONL may still retain history)

**Failure:** best-effort; compact still proceeds.

### 7.4 Not captured in v1

- Per-tool `write` / `edit` / `bash` observations  
- Prompt-submit every keystroke  
- Image / vision  

## 8. Read path

1. Tool `memory_recall({ query, limit? })` resolves cwd from the active agent session.  
2. FTS over memories (primary) and observations (secondary); merge/rank by FTS score.  
3. Return compact hits; model decides how to use them.  
4. **No** automatic system-prompt injection.

## 9. HTTP API

Base: local desktop trust model (same as other `/api/*`).

| Method | Path | Body / query | Response |
|--------|------|--------------|----------|
| GET | `/api/memory/health` | — | `{ ok, backend, ... }` |
| GET | `/api/memory/recall` | `cwd`, `q`, `limit?` | `{ hits: RecallHit[] }` |
| POST | `/api/memory/remember` | `{ cwd, content, type?, concepts?, files? }` | `{ id, type }` |
| POST | `/api/memory/forget` | `{ cwd, memoryIds?, observationIds? }` | `{ deleted }` |
| GET | `/api/memory/stats` | `cwd` | `{ memoryCount, observationCount }` (debug) |

- Missing `cwd` or empty `q`/`content` where required → 400 with stable error shape (`lib/api-error` patterns).  
- If `ltm.enabled === false` → 503 or 404 with clear message (pick one in implementation; prefer **503** + `{ error: "ltm_disabled" }`).

## 10. Agent tools

| Tool name | Maps to | Notes |
|-----------|---------|--------|
| `memory_save` | `remember` | Types as above |
| `memory_recall` | `recall` | |
| `memory_forget` | `forget` | Optional but recommended in v1 for governance |

Registration mechanism: follow existing desktop extension / Pi `registerTool` patterns used for other desktop tools so tools appear in the active tool list when LTM is enabled. Exact file placement left to implementation plan (prefer not to bloat `rpc-manager.ts` — thin glue only).

## 11. Configuration

Extend desktop settings (or env overrides) with:

| Key | Default | Meaning |
|-----|---------|---------|
| `ltm.enabled` | `true` | Master switch |
| `ltm.backend` | `"sqlite"` | `"sqlite"` \| `"agentmemory"` |
| `ltm.dbPath` | `~/.pi/agent/memory/ltm.sqlite` | SQLite path |
| `ltm.observeAgentEnd` | `true` | |
| `ltm.observePreCompact` | `true` | |
| `ltm.agentmemoryUrl` | `http://127.0.0.1:3111` | For future REST adapter |

When `backend === "agentmemory"` in v1: `health` reports not implemented; mutating/recall methods throw/return structured error **not** silent empty success.

## 12. Concurrency & process lifecycle

- Open DB with a single service instance per process; store on `globalThis` (HMR-safe, same rationale as `__piSessions`).  
- Serialize writes per process with a simple mutex/queue if better-sqlite3 / async driver needs it.  
- `close` on process exit optional; OS will release file handles.  
- Electron + Next child process: LTM lives in the **Node server process** that runs API routes (same as sessions), not in the BrowserWindow renderer.

## 13. Integration seams (do not break)

| Existing behavior | Constraint |
|-------------------|------------|
| JSONL schema / `session-reader` cold path | Unchanged |
| Fork pre-register then destroy | Unchanged; LTM is project-scoped not session-graph-scoped |
| Compact too-short guard | Still throw; observe only when compact will run |
| ToolCall normalize | Unrelated |
| `withFileLock` | Not required for SQLite if single connection + write queue; do not invent dual locking schemes |

## 14. Testing

| Area | Tests |
|------|--------|
| `projectIdFromCwd` | Windows-style case, relative→absolute, stability |
| Supersede helper | Above/below 0.7 threshold |
| Observe payload builders | Truncation, empty assistant |
| SqliteBackend | temp DB: remember, recall FTS, forget, supersede, observe |
| compact hook | mock service: observe called before compact when enabled |
| API routes | validation 400, happy path, disabled 503 |
| agentmemory stub | clear error |

Prefer pure functions + temp directories; no live network.

## 15. Implementation phases (this branch)

1. **Core:** types, project-id, backend interface, sqlite, service, globalThis  
2. **API:** `/api/memory/*` + tests  
3. **Hooks:** pre-compact + agent_end observe  
4. **Tools:** `memory_save` / `memory_recall` / `memory_forget`  
5. **Stub:** agentmemory backend + config switch  
6. **Docs:** link from `memory-architecture.html` / AGENTS notes if needed  

Do not start phase 2 until phase 1 unit tests pass, etc. Detailed task breakdown belongs in a **writing-plans** document after this spec is accepted.

## 16. Future (out of scope for v1 code)

- Real `AgentMemoryRestBackend` (hybrid search, viewer)  
- Opt-in inject (`ltm.injectContext`)  
- Project registry (stable id across cwd moves)  
- Embeddings / FTS + vector  
- Memory UI panel  
- Observe write/edit tools  
- Compact-triggered LLM extract into `memories` (not only observations)

## 17. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| DB growth | Truncation on observe; later retention job |
| Noisy agent_end | Truncation + kind filter in recall; settings to disable observe |
| Wrong project after path change | Documented v1 limitation; registry later |
| Hook misses agent_end | Integration test; prefer one server-side source of truth |
| better-sqlite3 native module in Electron | Prefer `node:sqlite` (Node 22+) if available in runtime, or pure `sql.js` / carefully validated native dep — **implementation plan must verify** Electron/Node version and choose one driver before coding |

## 18. Success criteria (v1 done)

1. Save a memory in session A; new session B same cwd can `memory_recall` it.  
2. Compact triggers a `pre_compact` observation retrievable by keyword.  
3. Agent end creates an `agent_end` observation without failing the turn.  
4. Disabling `ltm.enabled` stops tools/API from writing.  
5. Session JSONL still works offline if DB deleted (graceful degrade).  
6. Unit tests green for project id, sqlite backend, and API validation.

## 19. Approval

- Architecture brainstorm: 2026-08-03  
- User choices: C → backend 1 → projectId 1 → observe 1 → inject 1 → surface 1  
- Design draft approved (user confirmed) prior to this file  

**Next step:** user reviews this file; on OK, invoke **writing-plans** for an implementation plan on `feature/long-term-memory` (no feature code until plan exists and is accepted if required by workflow).
