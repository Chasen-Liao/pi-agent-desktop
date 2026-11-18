# Pi Agent Desktop - Development Notes

## Quick Start

```bash
npm run dev          # Web dev server (port 30141)
npm run dev:electron # Electron desktop (dev mode)
npm run dist         # Package: NSIS (Win) / DMG+ZIP (macOS) / DEB (Linux)
npm run dist:mac     # Universal macOS (Intel + Apple Silicon)
```

Typecheck: `npx tsc --noEmit` | Lint: `npm run lint`
Test: `npm test`（含 `middleware.test.ts`；不要去掉 `--test-force-exit`）
Subsets: `npm run test:windows` / `npm run test:macos`
**Never run `next build` during dev** — 污染 `.next/` 并破坏 `npm run dev`。

Release: 按 [docs/RELEASING.md](docs/RELEASING.md)，推 `vX.Y.Z` tag → CI 打包；不用 `npm run release`。
Branch: `dev/`（日常）/ `future/`（大功能），默认 merge commit，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

<!-- aoci:begin -->
## 项目索引

本项目默认使用 AOCI 定位代码、了解文件职责和关联。索引入口为 `aoci.txt`，文件条目在 `aoci.code.txt`。通过项目级 MCP 调用 `aoci_rules` 获取使用约定，再按索引定位到源码核实细节。

改动完成后运行 `aoci verify` 检查漂移；需要更新时调用 `aoci_maintain`，按返回的批次维护索引。
<!-- aoci:end -->

架构细节见 [架构文档](docs/ARCHITECTURE.md)。

## Key Traps

> 完整列表见 [ARCHITECTURE.md §14](docs/ARCHITECTURE.md#14-关键设计决策与陷阱)

### 1. Fork 预注册顺序

`send("fork")` → 创建新 `.jsonl` → `startRpcSession(newId)` 预注册 → `destroy()` 旧 wrapper。中途出错旧 wrapper **保持可用**；孤儿 `.jsonl` 删除与路径缓存失效是 **best-effort**（失败不阻断，随后 rethrow）。

### 2. 分支与工作区别混淆

- **Fork**（消息 Fork 按钮）→ 新 `.jsonl` + 侧边栏子节点
- **会话内分支**（Continue / BranchNavigator）→ 同文件 `navigate_tree`，切换用 `?leafId=`
- **Git Worktree Clone** → 在源 Git 仓库外创建新 worktree 和分支后再 Clone 会话；目标、分支与 worktree 身份无法证明时 fail closed

### 3. ToolCall 字段归一化

SDK 存 `{id, name, arguments}`，前端用 `{toolCallId, toolName, input}`。`normalizeToolCalls()` 在文件加载和 SSE 流两处都转换。

### 3b. 模型列表不要退回 ModelRuntime.create-only

`createPiRuntime` 必须再走 `createAgentSessionServices`，否则扩展注册的模型从选择器消失。详见 [ARCHITECTURE.md §14.17](docs/ARCHITECTURE.md#1417-模型列表必须走-createagentsessionservices2026-09-08-34)。

### 4–6. 打包陷阱（摘要）

- `node_modules` 须独立 extraResources 条目（`filter:["**/*"]` 静默排除它）
- Frontend 依赖放 `devDependencies`；`outputFileTracingExcludes` 排除 `release/`/`.git/`/`dist/`/`*.test.*`
- `build:standalone` 须补齐 Next turbo runtime；macOS Universal 须双架构 Sharp

### 7. 测试文件的运行时 import 必须用相对路径

`npm test` 走 `node --test` 直接执行 TS 文件，**不解析 `tsconfig` 的 `paths`**，所以运行时 import 不能用 `@/` 别名（`import { x } from "@/lib/y"` 会报模块找不到）。只有 `import type` 可以用别名——类型导入会被擦除，不产生运行时解析。跨目录一律写相对路径并带扩展名：`from "../../lib/types.ts"`。

### 8. `electron/csp.ts` 与 `lib/csp.ts` 必须保持两份且逐字一致

`electron/tsconfig.json` 的 `rootDir` 是 `electron/`，electron 侧无法 `import` `../lib`，所以 CSP 指令表有两份副本。**改一侧必须同步另一侧**：`lib/csp.test.ts` 里的 parity 用例会断言两者输出逐字节相等（这也是唯一能发现漂移的守卫）。

### 9. 写路由层测试的两个前提

`npm test` 走 `node --test` 直接执行 TS 文件，因此路由要能被测试必须满足两点：

1. **import 写成可解析的形式**：`next/server.js`（不是 `next/server`）＋ 相对路径带扩展名（`../../../lib/api-error.ts`，不是 `@/lib/api-error`）。`next/server` 在 ESM 下解析不到，`@/` 别名也不被 `node --test` 解析（`import type` 除外，类型导入会被擦除）。需要测试的路由按此约定调整。
2. **隔离 agent dir**：`ProjectTrustStore` 会向上继承父目录的信任决策，而真实 store 在 `~/.pi/agent`。若曾经信任过某个父目录（例如 `%TEMP%`），它下面所有目录都会被判为"已信任"，依赖"未信任"状态的测试就会随机失败。测试里设置 `process.env.PI_CODING_AGENT_DIR` 指向临时目录即可完全隔离（pi 的 `getAgentDir()` 每次调用都读该变量）。

---

## Misc

**Session 文件**：`~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`（详见 [ARCHITECTURE.md §9](docs/ARCHITECTURE.md#9-pi-会话文件格式)）。`SessionContext.entryIds[]` 与 `messages[]` 一一对应，用于 fork 和 navigate_tree。

**CSS 变量**：完整变量表见 [`app/globals.css`](app/globals.css)，含 `material-*` / `shadow-*` / `duration-*` / `ease-*` / `toast-*` / `think-*` 等动画 token 体系。

**UI 文案**：走 `lib/i18n`（`en` / `zh-CN`）。改文案须同步 `lib/i18n/dictionaries.ts` 双语，不硬编码。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
