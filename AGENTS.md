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

### 五个必须存 `globalThis` 的原因

Next.js HMR 会丢弃模块级变量，因此以下五个必须挂在 `globalThis` 上：

- `globalThis.__piSessions` — `Map<sessionId, AgentSessionWrapper>` 活跃会话注册表（[lib/rpc-manager.ts](lib/rpc-manager.ts)）
- `globalThis.__piSessionPathCache` — `sessionId → .jsonl` 路径缓存（[lib/session-reader.ts](lib/session-reader.ts)）
- `globalThis.__piStartLocks` — 并发启动共享 Promise 锁（[lib/rpc-manager.ts](lib/rpc-manager.ts)）
- `globalThis.__piWriteLocks` — per-file 写入锁（[lib/session-lock.ts](lib/session-lock.ts)）
- `globalThis.__piAllowedRootsCache` — 文件访问白名单缓存（5s TTL）（[lib/allowed-roots.ts](lib/allowed-roots.ts)）

---

## Key Design Decisions & Traps

> 📖 完整的设计决策与陷阱列表已在 [docs/ARCHITECTURE.md §14](docs/ARCHITECTURE.md#14-关键设计决策与陷阱) 归档。
> 本节仅保留**最频繁踩坑**的 5 个要点速查。

### 1. Fork 的预注册顺序

`send("fork")` 先创建新 `.jsonl` 文件，然后 `await startRpcSession(newSessionId, ...)` **预注册**新 wrapper，最后 `this.destroy()` 旧 wrapper。若中间抛错，旧 wrapper **不销毁**（保持可用），孤儿文件可接受（下次覆盖）。

### 2. 两种分支别搞混

- **Fork**（用户消息 Fork 按钮）→ 创建新的 `.jsonl` 文件，侧边栏显示为子节点
- **会话内分支**（Continue / BranchNavigator）→ 同一文件内 `navigate_tree`，切换调 `?leafId=`

### 3. ToolCall 字段归一化

Pi SDK 存 `{id, name, arguments}`，前端用 `{toolCallId, toolName, input}`。`normalizeToolCalls()` 在文件加载和 SSE 流两处都做转换。

### 4. Electron extraResources 必须单独含 node_modules

`filter: ["**/*"]` **静默排除** `node_modules` 目录。必须另加一条 extraResources 单拉 `node_modules`——详见 [ARCHITECTURE.md §14.6](docs/ARCHITECTURE.md#146-electron-builder-extraresources-必须单独包含-node_modules)。

### 5. Electron 打包大小 & Next.js NFT 套娃陷阱

Frontend 依赖必须放 `devDependencies`（否则 electron-builder 盲目打包进 app.asar）。`next.config.ts` 必须加上 `outputFileTracingExcludes: { "/": ["release/**/*", ".git/**/*"] }` 防止 NFT 把旧安装包拉进 build，造成指数级套娃膨胀。详见 [ARCHITECTURE.md §14.12](docs/ARCHITECTURE.md#1412-electron-打包大小--nextjs-nft-套娃陷阱)。

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
