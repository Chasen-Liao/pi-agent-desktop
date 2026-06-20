# Pi Agent Web - Development Notes

## Quick Start

```bash
# Web dev server
npm run dev          # port 30141

# Electron desktop app (dev mode)
npm run dev:electron # builds electron + opens window

# Production build & package
npm run dist         # Next.js build + Electron build + NSIS installer
```

Typecheck: `npx tsc --noEmit`  
Lint: `npm run lint`  
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

---

## CodeGraph MCP (Code Querying)

CodeGraph provides MCP (Model Context Protocol) tools for efficient symbol searching, file reading, and codebase exploration. When the workspace is indexed (indicated by a `.codegraph/` directory), agents should prefer these tools to save context window tokens and reduce query round-trips.

### Available Tools

- **`codegraph_explore`**: The primary tool for querying how something works or finding related files/symbols. Accept natural-language queries or symbol/file lists (e.g., `query: "rpc-manager session fork"`). Returns source code and call paths in a single call.
- **`codegraph_node`**:
  - *File reading*: Use it as a faster alternative to `view_file` (pass `file` and omit `symbol`). It returns the file content with line numbers and lists all files that depend on it.
  - *Symbol querying*: Query a specific symbol's definition, signature, and caller/callee details (pass `symbol`, set `includeCode: true`).
- **`codegraph_search`**: Fast symbol-name search (returns locations/filenames only, no code). Useful to locate where a symbol is defined.

### Indexing

- The workspace must be indexed (have a `.codegraph/` directory) to use these tools.
- To initialize indexing, run `codegraph init` in the project root. (Do not run this automatically; indexing is a user-level choice).

## Architecture

> 📖 **详细架构文档已迁移至 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** —— 包含完整的目录地图、组件清单、API 路由清单、Electron 桌面端说明、设计决策与陷阱。
> 本节仅保留**开发时高频查阅**的速查摘要。

### 双模式架构速查

- **Web 模式**：浏览器 ──HTTP/SSE──▶ Next.js Server(:30141) ──进程内──▶ AgentSession
- **Desktop 模式**：Electron 主进程以 `ELECTRON_RUN_AS_NODE=1` 启动 Next.js standalone `server.js` 子进程，再开 `BrowserWindow` 指向 `http://127.0.0.1:PORT`

### 关键入口

- **发送消息**：`POST /api/agent/[id]` → `startRpcSession()` (lib/rpc-manager.ts) 创建 `AgentSessionWrapper`
- **浏览历史**（只读）：`GET /api/sessions/*` → `lib/session-reader.ts` 直接解析 `.jsonl`，**不创建** AgentSession
- **SSE 流**：`GET /api/agent/[id]/events` —— 30s 心跳，单向推送
- **UI 主入口**：`app/page.tsx` → `components/AppShell.tsx` → `components/ChatWindow.tsx` → `hooks/useAgentSession.ts`

### 顶层目录速查

| 目录 | 用途 |
|---|---|
| `app/api/` | 24 条 API 路由（agent / sessions / files / models / skills / auth / health） |
| `lib/` | 服务端库：`rpc-manager` / `session-reader` / `normalize` / `session-cascade` 等 |
| `components/` | 17 个顶层组件 + `chat-input/` / `session-sidebar/` / `models-config/` 子目录 |
| `hooks/` | 6 个顶层 hook + `agent-session/` 子目录下 8 个拆分 hook |
| `electron/` | 主进程 `main.ts` + `preload.ts` / `tray.ts` + 7 个辅助模块 |
| `bin/pi-web.js` | CLI 入口（`npm i -g` / `npx`） |

### 三个必须存 `globalThis` 的原因

Next.js HMR 会丢弃模块级变量，因此以下三个必须挂在 `globalThis` 上：

- `globalThis.__piSessions` — `Map<sessionId, AgentSessionWrapper>` 活跃会话注册表
- `globalThis.__piSessionPathCache` — `sessionId → .jsonl` 路径缓存
- `globalThis.__piStartLocks` — 并发启动共享 Promise 锁

---

## Key Design Decisions & Traps

### AgentSession lifecycle (`lib/rpc-manager.ts`)

- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)

### Fork must pre-register the new wrapper before destroying the old one

`AgentSession.fork()` **mutates the wrapper's inner state in-place** — after fork, `inner.sessionId` is the *new* session's id. If the wrapper stays alive in the registry under the old id, the next request gets the already-forked state and subsequent forks produce a corrupt `parentSession` chain.

**Fix**: `send("fork")` first calls `startRpcSession(newSessionId, newSessionFile, cwd)` to **pre-register the new wrapper while the old one is still alive**, then calls `this.destroy()`, then returns `newSessionId`. Contract: by the time `send()` returns, `newSessionId` is already in the registry. If `startRpcSession` throws, the old wrapper is **not** destroyed — it stays usable under the old id (the orphaned new `.jsonl` file on disk is acceptable; the next fork will overwrite it). The next request for the original session id reloads a clean AgentSession from the original file.

### Two kinds of branching — don't confuse them

- **Fork** (Fork button on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** (Continue button / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Session files can be fully rewritten

`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to `writeFileSync` the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete.

### ToolCall field normalization

Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `ChatWindow.handleAgentEvent()` (streaming).

### New session tool preset

Tool names are passed at session creation (`POST /api/agent/new` → `toolNames[]`). For existing sessions, the active preset is inferred on mount via `get_tools` → `getPresetFromTools()`. When tools are fully disabled (`toolNames = []`), `rpc-manager.ts` clears the system prompt entirely in the AgentSession state.

### Model defaults for new sessions

`GET /api/models` returns `defaultModel` read from `~/.pi/agent/settings.json`. `ChatWindow` pre-selects this on mount for new sessions.

### SSE reconnect on page refresh mid-stream

On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

### Compaction SSE events

Newer pi emits `compaction_start` / `compaction_end`; older versions emitted `auto_compaction_start` / `auto_compaction_end`. `handleAgentEvent` accepts both sets to keep `isCompacting` in sync. Manual compact is a blocking POST — the button stays disabled until the response returns.

### Orphaned sessions

Sessions whose first line can't be parsed as a valid header are marked `orphaned: true` in the API response — displayed with an "incomplete" badge in the sidebar and not clickable.

### Electron extraResources must include node_modules separately

electron-builder's `extraResources` with `filter: ["**/*"]` **silently excludes `node_modules` directories**, even from `.next/standalone`. The standalone `server.js` does `require("next")` which fails without `node_modules/next`. **Fix**: add a separate `extraResources` entry for `node_modules` — see [docs/ARCHITECTURE.md §14.6](docs/ARCHITECTURE.md#146-electron-builder-extraresources-必须单独包含-node_modules) for the full YAML.

### Electron main process spawns Next.js as a child

In production, `electron/main.ts` spawns `process.execPath` (the Electron binary itself) with `ELECTRON_RUN_AS_NODE=1` to run `server.js` as a plain Node.js process. The main process then opens a `BrowserWindow` pointing at `http://127.0.0.1:PORT`. The child process is killed on `before-quit`. See [docs/ARCHITECTURE.md §13](docs/ARCHITECTURE.md#13-electron-桌面端) for the full Electron module map.

---

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl` — see [docs/ARCHITECTURE.md §9](docs/ARCHITECTURE.md#9-pi-会话文件格式) for the complete `.jsonl` schema and `parentSession` semantics.

Quick reference for code: `entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate_tree calls.

---

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```
