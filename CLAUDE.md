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

# 构建当前平台安装包（Windows NSIS / macOS DMG + ZIP）
npm run dist

# 构建 Intel + Apple Silicon Universal macOS 安装包
npm run dist:mac
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

## 核心能力与当前状态 (Wave 1 & Wave 2 已完成)

- **Agent 安全模式与 Ask 拦截**：支持 `plan` / `ask` / `full` 三种 AgentMode，`ask` 模式下拦截 `bash` / `write` / `edit` 等写工具操作并向 UI 发起确认。
- **Extension UI Bridge**：通过 SSE 桥接支持 Extension `confirm` / `select` / `input` / `editor` / `notify` 等交互式 UI 弹窗与通知。
- **Project Trust 409 握手**：对未信任的项目路径在创建/载入 Session 时触发 409 `needsTrust` 响应并弹出 Trust 授权对话框。
- **MCP 服务器管理**：读写全局 (`~/.pi/agent/mcp.json`) 和项目级 (`<cwd>/.pi/mcp.json`) MCP 配置，支持连接测试、开关与工具计数管理。
- **扩展与 Skill 管理**：统一配置面板管理已加载 Extension、Skill 启用状态与诊断信息。
- **会话 Branching & Cloning**：支持从会话节点分叉新分支 (`/api/sessions/[id]/branch`) 或全量 Clone 到目标目录 (`/api/sessions/[id]/clone`)。
- **会话导出 (HTML/MD)**：支持将会话流式或静态导出为独立的 HTML（含语法高亮）或 Markdown 文件 (`/api/sessions/[id]/export`)。
- **AgentMode `.jsonl` 持久化**：在模式切换时向 Session `.jsonl` 追加 `desktop_agent_mode` Custom Entry，Session 重载时自动恢复历史模式。
- **长期记忆 LTM（v0.7.19）**：项目级 SQLite 记忆库 `lib/ltm`；工具 `memory_save` / `memory_recall` / `memory_forget`；API `/api/memory/*`；`agent_end` 与 compact 前自动 observe。设计见 [docs/superpowers/specs/2026-08-03-long-term-memory-design.md](docs/superpowers/specs/2026-08-03-long-term-memory-design.md)；会话记忆基线见 [docs/memory-architecture.html](docs/memory-architecture.html)。
- **可重排 Follow-up Queue（v0.8.0）**：Agent 运行中 Enter 发送 steer、Alt+Enter 排队；队列由 `AgentSessionWrapper` 管理并通过 SSE 同步，支持拖拽或键盘重排。

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
| `app/api/` | **38** 条 API 路由（含 **memory** 5 条；另有 agent / sessions / files / models / skills / auth / health / mcp / extensions / trust / desktop-settings 等） |
| `lib/` | 服务端库：`rpc-manager` / `session-reader` / **`ltm/`** / **`i18n/`** / `approval-policy` / `extension-ui-bridge` / `mcp-config` / `session-export` / `session-branch-clone` 等 |
| `components/` | 27 个顶层组件（含 `I18nProvider` / `AgentThinkingOrb` / `LiquidOrbCanvas` / `McpConfigModal` / `ExtensionUiDialog` / `AgentModeSelector` 等） |
| `hooks/` | 6 个顶层 hook + `agent-session/` 子目录下 15 个拆分模块 |
| `electron/` | 主进程 `main.ts` + `preload.ts` / `tray.ts` + 14 个辅助模块 |
| `bin/pi-web.js` | CLI 入口（`npm i -g` / `npx`） |

### 最常踩坑的设计决策

- **活跃 session 注册表必须存 `globalThis`**：Next.js HMR 会丢弃模块级变量；至少：`__piSessions` / `__piSessionPathCache` / `__piStartLocks` / `__piWriteLocks` / `__piAllowedRootsCache`；LTM 另有 `__piLtmService`（见 `lib/ltm/service.ts`）。详见 [AGENTS.md](AGENTS.md#必须存-globalthis-的原因) 与 [docs/ARCHITECTURE.md §14.1](docs/ARCHITECTURE.md)。
- **Electron 打包 + 原生运行时**：`build:standalone` 在 `next build` 后补齐 Next turbo runtime、Pi 运行时依赖和 macOS 双架构 Sharp。不要删除这些 ensure 脚本，也不要删除 `electron-builder.yml` 的 `mac.x64ArchFiles`，否则桌面端会卡在启动页、Universal 合并失败或 Intel 端加载原生模块失败。
- **macOS 后台服务不能直接执行 App 主程序**：packaged macOS 必须用 `utilityProcess.fork(server.js)`；若改回 `spawn(process.execPath)` + `ELECTRON_RUN_AS_NODE`，Dock 会出现持续弹跳的黑色 `exec` 图标。
- **用户可见文案走 `lib/i18n`**：`en` / `zh-CN`，偏好可 `system`；新增字符串同步改 `dictionaries.ts` 两边。
- **两种分支不要混淆**：**Fork / Branch** = 跨文件新 `.jsonl`（`POST /api/sessions/[id]/branch` 或 `POST /api/agent/[id]` with `{type:"fork"}`）；**会话内分支** = 同文件 `navigate_tree` + `GET /api/sessions/[id]/context?leafId=`。
- **Fork 后必须立即销毁旧 wrapper**：Fork 在文件层通过 `SessionManager.createBranchedSession()`（或首条消息前的 `SessionManager.create()`）创建新 `.jsonl`，再用 `startRpcSession()` 构造全新 AgentSession 实例；旧 wrapper 不再会被请求到，立即 `destroy()` 可及时释放资源（而非等 10 分钟 idle 超时）。详见 [docs/ARCHITECTURE.md §14.2](docs/ARCHITECTURE.md#142-fork-的执行顺序预注册--销毁旧-wrapper)。

> 更完整的设计决策与陷阱清单（ToolCall 归一化、SSE 重连、electron-builder extraResources、Windows 兼容层等）见 [docs/ARCHITECTURE.md §14](docs/ARCHITECTURE.md#14-关键设计决策与陷阱)。
<!-- rules-aio:start -->
@.claude/rules/nextjs.md
@.claude/rules/react.md
@.claude/rules/typescript.md
@.claude/rules/nodejs.md
<!-- rules-aio:end -->
