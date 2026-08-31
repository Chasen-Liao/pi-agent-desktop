# Pi Agent Desktop - Development Notes

## Quick Start

```bash
# Web dev server
npm run dev          # port 30141

# Electron desktop app (dev mode)
npm run dev:electron # builds electron + opens window

# Production build & package
npm run dist         # Current OS package: NSIS on Windows, DMG + ZIP on macOS
npm run dist:mac     # Universal macOS package (Intel + Apple Silicon)
```

Typecheck: `npx tsc --noEmit`  
Lint: `npm run lint`  
Test: `npm test`（含根目录 `middleware.test.ts`；不要去掉 `--test-force-exit`，否则套件不退出）  
Windows CI subset: `npm run test:windows`
macOS CI subset: `npm run test:macos`
**Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

Release：按 [docs/RELEASING.md](docs/RELEASING.md) 执行；桌面 GitHub Release 不使用会自动 bump patch 的 `npm run release`。

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
- **Desktop 模式**：Electron 主进程托管 Next.js standalone `server.js`（macOS 使用无 Dock 图标的 `utilityProcess`；Windows/Linux 使用 `ELECTRON_RUN_AS_NODE=1`），再开 `BrowserWindow` 指向 `http://127.0.0.1:PORT`

### 关键入口

- **发送消息**：`POST /api/agent/[id]` → `startRpcSession()` (lib/rpc-manager.ts) 创建 `AgentSessionWrapper`
- **浏览历史**（只读）：`GET /api/sessions/*` → `lib/session-reader.ts` 直接解析 `.jsonl`，**不创建** AgentSession
- **SSE 流**：`GET /api/agent/[id]/events` —— 30s 心跳，单向推送
- **UI 主入口**：`app/page.tsx` → `components/AppShell.tsx` → `components/ChatWindow.tsx` → `hooks/useAgentSession.ts`
- **长期记忆 LTM**：`lib/ltm` · API `/api/memory/*` · tools `memory_save` / `memory_recall` / `memory_forget`（设计见 [docs/superpowers/specs/2026-08-03-long-term-memory-design.md](docs/superpowers/specs/2026-08-03-long-term-memory-design.md)）
- **运行中消息**：Enter 立即 steer，Alt+Enter 加入 wrapper 管理的 Follow-up Queue；队列支持重排，不能改回 Pi SDK 原生不可变队列

### 顶层目录速查

| 目录 | 用途 |
|---|---|
| `app/api/` | API 路由（agent / sessions / files / models / models-config / skills / auth / health / mcp / extensions / trust / desktop-settings / statusline / **memory** 等共 38 条） |
| `lib/` | 服务端库：`rpc-manager` / `session-reader` / `approval-policy` / `extension-ui-bridge` / `mcp-config` / `session-export` / `session-branch-clone` / **`ltm`** / **`i18n`** 等 |
| `components/` | 27 个顶层组件（含 `I18nProvider` / `McpConfigModal` / `SessionExportModal` / `ExtensionsConfigModal` / `ProjectTrustDialog` / `ExtensionUiDialog` / `AgentModeSelector` 等） |
| `hooks/` | 6 个顶层 hook + `agent-session/` 子目录下 15 个拆分模块 |
| `electron/` | 主进程 `main.ts` + `preload.ts` / `tray.ts` + 14 个辅助模块 |
| `bin/pi-web.js` | CLI 入口（`npm i -g` / `npx`） |
### 必须存 `globalThis` 的原因

Next.js HMR 会丢弃模块级变量，因此会话与 LTM 相关状态必须挂在 `globalThis` 上：

- `globalThis.__piSessions` — `Map<sessionId, AgentSessionWrapper>` 活跃会话注册表（[lib/rpc-manager.ts](lib/rpc-manager.ts)）
- `globalThis.__piSessionPathCache` — `sessionId → .jsonl` 路径缓存（[lib/session-reader.ts](lib/session-reader.ts)）
- `globalThis.__piStartLocks` — 并发启动共享 Promise 锁（[lib/rpc-manager.ts](lib/rpc-manager.ts)）
- `globalThis.__piWriteLocks` — per-file 写入锁（[lib/session-lock.ts](lib/session-lock.ts)）
- `globalThis.__piAllowedRootsCache` — 文件访问白名单缓存（5s TTL）（[lib/allowed-roots.ts](lib/allowed-roots.ts)）
- `globalThis.__piLtmService` — 长期记忆 `MemoryService` 单例（[lib/ltm/service.ts](lib/ltm/service.ts)）

---

## Key Design Decisions & Traps

> 📖 完整的设计决策与陷阱列表已在 [docs/ARCHITECTURE.md §14](docs/ARCHITECTURE.md#14-关键设计决策与陷阱) 归档。
> 本节仅保留**最频繁踩坑**的要点速查。

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

Frontend 依赖必须放 `devDependencies`（否则 electron-builder 盲目打包进 app.asar）。`next.config.ts` 的 `outputFileTracingExcludes` 必须排除 `release/`、`.git/`、`dist/` 和 `*.test.*`，否则 NFT 会把旧安装包和测试文件打进 standalone。详见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)。

### 6. Next 16 Turbopack standalone 必须补齐 turbo runtime

`build:standalone` 会在 `next build` 后依次补齐 Next、Pi 和 macOS Universal 原生运行时。缺少 Next turbo runtime 会导致安装包卡在启动页；缺少 macOS 双架构 Sharp 或删除 `mac.x64ArchFiles` 会导致 Universal 合并失败或 Intel 端运行时错误。详见 [ARCHITECTURE.md §14.10b](docs/ARCHITECTURE.md#1410b-next-16-turbopack-standalone-缺-app-route-runtime2026-08-03) 与 [§14.10c](docs/ARCHITECTURE.md#1410c-macos-universal-必须补齐双架构原生运行时)。

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

## UI 文案

用户可见字符串走 `lib/i18n`（`en` / `zh-CN`，偏好可 `system`）。新增或改文案时同步改 `lib/i18n/dictionaries.ts` 两边，不要硬编码。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
