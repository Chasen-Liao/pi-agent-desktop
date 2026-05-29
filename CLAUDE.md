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

# 运行当前已有的 Node test 测试
node --test lib/custom-path-selection.test.ts

# 构建 Next.js standalone 输出
npm run build

# 打包目录版 Electron 应用
npm run pack

# 构建 NSIS 安装包
npm run dist
```

`AGENTS.md` 明确提醒：开发时不要直接运行 `next build`，会污染 `.next/` 并影响 `npm run dev`。如确需验证生产构建，使用项目脚本 `npm run build` 或完整打包脚本。

## 高层架构

- `app/page.tsx` 渲染 `components/AppShell.tsx`，`AppShell` 负责整体布局、URL 中的 `?session=` 状态、左右面板、文件标签、模型/技能配置弹窗，以及把分支树、系统提示词、token/cost 和上下文用量提升到顶栏。
- `components/ChatWindow.tsx` 是对话区域外壳，主要委托 `hooks/useAgentSession.ts` 处理会话加载、SSE 连接、发送/中止/分叉/导航/压缩/模型切换/工具预设等 agent 交互。
- `components/SessionSidebar.tsx` 展示按工作目录组织的会话树，并集成 `FileExplorer`；`FileViewer` 和 `TabBar` 组成右侧文件查看面板。
- `app/api/sessions/*` 读取、更新、删除 pi 的 `.jsonl` 会话文件，并通过 `/context?leafId=` 返回某个会话内分支叶子的上下文。
- `app/api/agent/*` 负责新建/恢复 agent session、发送命令和暴露 SSE 事件流。浏览历史只读会话文件；真正发送消息时才创建 `AgentSession`。
- `lib/session-reader.ts` 封装 pi `SessionManager`，负责列出会话、缓存 session id 到文件路径、构建会话树和把 pi 的 session context 转成 UI 类型。
- `lib/rpc-manager.ts` 包装 `@earendil-works/pi-coding-agent` 的 `AgentSession`，用 `globalThis.__piSessions` 和 `globalThis.__piStartLocks` 跨 Next.js 热更新保存活跃 session 与并发启动锁。
- `lib/normalize.ts` 统一 tool call 字段。pi 文件格式使用 `{ id, name, arguments }`，UI 类型使用 `{ toolCallId, toolName, input }`。
- `app/api/auth/*`、`app/api/models*`、`app/api/skills*` 分别处理认证提供商、模型配置和技能列表/搜索/安装。
- `electron/main.ts` 是 Electron 主进程：寻找端口、以 `ELECTRON_RUN_AS_NODE=1` 启动 Next.js standalone `server.js` 子进程、创建 `BrowserWindow`、托盘和自动更新。`electron/preload.ts` 通过 context bridge 暴露更新相关 API。

## 会话与分支模型

- Pi 会话文件位于 `~/.pi/agent/sessions/<encoded-cwd>/...jsonl`。
- “Fork” 会创建新的独立 `.jsonl` 文件，并通过 header 中的 `parentSession` 显示为侧边栏树的子会话。
- “会话内分支” 仍在同一个 `.jsonl` 文件内，通过不同 entry 的 `parentId` 和 `navigate_tree` 切换，UI 使用 `BranchNavigator` 与 `/api/sessions/[id]/context?leafId=` 展示指定路径。
- `entryIds[]` 与显示的 `messages[]` 平行，用于把 UI 消息映射回 `.jsonl` entry id，以支持 fork 和会话内导航。

## 关键注意事项

- `AgentSession.fork()` 会原地改变 wrapper 内部 session 状态；`lib/rpc-manager.ts` 在 fork 后必须销毁旧 wrapper，避免旧 id 指向已 fork 的状态。
- 活跃 session registry 必须放在 `globalThis`，普通模块级 Map 会被 Next.js 热更新重置。
- 发送新消息走 `/api/agent/[id]` 和 SSE；只浏览历史走 `lib/session-reader.ts`，不要为只读浏览创建 `AgentSession`。
- `electron-builder.yml` 需要把 `.next/standalone/node_modules` 作为单独 `extraResources` 项复制；单纯复制 standalone 会漏掉 `node_modules/next`。
- `next.config.ts` 使用 `output: "standalone"`，并把 `@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-ai` 设为 server external packages。
- ESLint 配置位于 `eslint.config.mjs`，忽略 `.next/`、`electron/dist/`、`release/`、`out/`、`coverage/`，并关闭部分 React Hooks 规则。
