# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目目标

Pi Agent Desktop 是一个面向 Pi 编程智能体的极简个人 Codex 风格桌面端。它复用同一套 Next.js/React UI，同时支持浏览器开发模式和 Electron 桌面应用模式。

## 常用命令

```bash
# 安装依赖
npm install

# 浏览器开发模式，端口 30141
npm run dev

# Electron 桌面开发模式：先编译 electron/，再启动 Electron
npm run dev:electron

# 类型检查
npx tsc --noEmit

# Lint
npm run lint

# 运行测试（包括 lib/、electron/、app/、hooks/、components/ 等的全部测试文件）
npm run test

# 构建 Next.js standalone 输出
npm run build

# 打包目录版 Electron 应用
npm run pack

# 构建 NSIS 安装包
npm run dist
```

`AGENTS.md` 明确提醒：开发时不要直接运行 `next build`，会污染 `.next/` 并影响 `npm run dev`。如确需验证生产构建，使用项目脚本 `npm run build` 或完整打包脚本。

## CodeGraph MCP 代码查询

当工作区已索引（存在 `.codegraph/` 目录）时，推荐优先使用 CodeGraph MCP 工具来查询和探索代码，以减少 Token 消耗和往返次数：

- **`codegraph_explore`**：首选探索工具。输入自然语言问题或一组符号/文件名（例如：`rpc-manager session fork`），它会合并返回相关符号的源码和调用路径。
- **`codegraph_node`**：
  - **文件读取**：当只需读取某个文件时，可传入 `file`（不传 `symbol`），它比普通文件读取工具更快，并会额外附带哪些文件依赖了该文件（Blast Radius 爆破半径分析）。
  - **符号查询**：传入 `symbol` 和 `includeCode: true` 可单独查询某个具体符号的定义、签名及调用者/被调用者轨迹。
- **`codegraph_search`**：快速的符号名称搜索（只返回位置/文件名，不返回源码），适用于快速定位符号位置。

> [!NOTE]
> 索引状态是由用户决定的。如果项目没有 `.codegraph/` 文件夹，可以通过在项目根目录运行 `codegraph init` 初始化索引。

## 高层架构

> 📖 **完整架构文档见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** —— 以下仅保留开发时高频查阅的速查摘要。

### 关键入口

- **发送消息**：`POST /api/agent/[id]` → `lib/rpc-manager.ts` 的 `startRpcSession()` 创建 `AgentSessionWrapper`
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

### 三条最常踩坑的设计决策

- **活跃 session 注册表必须存 `globalThis`**：Next.js HMR 会丢弃模块级变量；五个 globalThis 变量必须挂在 globalThis 上：`__piSessions`（活跃会话注册表）/ `__piSessionPathCache`（路径缓存）/ `__piStartLocks`（并发启动锁）/ `__piWriteLocks`（per-file 写入锁）/ `__piAllowedRootsCache`（文件访问白名单 5s TTL）。详见 [AGENTS.md](AGENTS.md#五个必须存-globalthis-的原因) 与 [docs/ARCHITECTURE.md §14.1](docs/ARCHITECTURE.md)。
- **两种分支不要混淆**：**Fork** = 跨文件新 `.jsonl`（`POST /api/agent/[id]` with `{type:"fork"}`）；**会话内分支** = 同文件 `navigate_tree` + `GET /api/sessions/[id]/context?leafId=`。
- **Fork 后必须立即销毁旧 wrapper**：Fork 在文件层通过 `SessionManager.createBranchedSession()`（或首条消息前的 `SessionManager.create()`）创建新 `.jsonl`，再用 `startRpcSession()` 构造全新 AgentSession 实例；旧 wrapper 不再会被请求到，立即 `destroy()` 可及时释放资源（而非等 10 分钟 idle 超时）。详见 [docs/ARCHITECTURE.md §14.2](docs/ARCHITECTURE.md#142-fork-的执行顺序预注册--销毁旧-wrapper)。

> 更完整的设计决策与陷阱清单（ToolCall 归一化、SSE 重连、electron-builder extraResources、Windows 兼容层等）见 [docs/ARCHITECTURE.md §14](docs/ARCHITECTURE.md#14-关键设计决策与陷阱)。

<!-- rules-aio:start -->
@.claude/rules/nextjs.md
@.claude/rules/react.md
@.claude/rules/typescript.md
@.claude/rules/nodejs.md
<!-- rules-aio:end -->
