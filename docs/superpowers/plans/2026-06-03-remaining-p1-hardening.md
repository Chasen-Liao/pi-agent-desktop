# 剩余 P1 架构加固计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not implement multiple task groups in one commit unless the group explicitly says so.

**Goal:** 基于 `main` @ `10951f9` 处理剩余 P1 项，降低运行时静默失败、桌面端启动脆弱性、打包维护成本和 SSRF 风险，同时控制改动范围。

**Current baseline:**
- P0-4 已完成：`electron/main.ts` 现在通过 `pickApiKeys(process.env)` 过滤 Next.js 子进程 env。
- P1-4 已完成：`components/AppShell.tsx` / `components/SessionSidebar.tsx` 已切到受控 cwd 状态。
- 剩余 P1：P1-2、P1-3、P1-5、P1-6、P1-7、P1-8、P1-9、P1-10。

**Recommended batching:**
1. Batch A：P1-2 + P1-10，低风险 UI/日志修复。
2. Batch B：P1-8 + P1-9，安全边界修复。
3. Batch C：P1-5 + P1-6，Electron 启动生命周期修复。
4. Batch D：P1-7，打包资源维护性修复。
5. Batch E：P1-3，大文件渲染性能修复；需要单独评估依赖或无依赖方案。

**Validation commands:**
- `npx tsc --noEmit`
- `npm run lint`
- `node --test lib/*.test.ts electron/*.test.ts app/**/*.test.ts`
- Electron 相关批次额外运行：`npm run build:electron`
- 打包资源批次额外运行：`npm run pack`

Do not run `next build` directly. If production build validation is required, use `npm run build`.

---

## Batch A: P1-2 SSE parse logging + P1-10 derived value memoization

**Goal:** 让 SSE 非法事件不再静默丢失；减少 `useAgentSession` 每次渲染中的重复派生计算。

### Task A1: 记录 SSE JSON.parse 失败

**Files:**
- Modify: `hooks/agent-session/use-agent-events.ts`

**Current finding:**
- `hooks/agent-session/use-agent-events.ts:34-40` 捕获 `JSON.parse(e.data)` 失败后直接 ignore。

**Implementation:**
- [ ] 在 `catch` 中记录 `console.error` 或项目已有日志方式。
- [ ] 日志应包含固定前缀和原始 `e.data`，但不要中断 EventSource。
- [ ] 保持 reconnect 行为不变。

**Success criteria:**
- 非法 SSE payload 可在开发者控制台看到错误。
- 合法 SSE 消息处理不变。

### Task A2: memoize `currentModel` / `displayModel` / `sessionStats`

**Files:**
- Modify: `hooks/useAgentSession.ts`

**Current finding:**
- `hooks/useAgentSession.ts:101-104` 每次 render 都直接计算 `currentModel`、`displayModel`、`calculateSessionStats(messages)`。

**Implementation:**
- [ ] 引入或使用已有 `useMemo` import。
- [ ] `currentModel` 依赖：`currentModelOverride`、`data?.context.model`、`pendingModel`。
- [ ] `displayModel` 依赖：`isNew`、`newSessionModel`、`currentModel`。
- [ ] `sessionStats` 依赖：`messages`。

**Success criteria:**
- TypeScript 通过。
- `displayModel` 在新会话和历史会话里的行为不变。

**Validation:**
- [ ] `npx tsc --noEmit`
- [ ] `npm run lint`

---

## Batch B: P1-8 startup CSP + P1-9 skills search allowlist

**Goal:** 收紧启动页 CSP，阻止 `SKILLS_API_URL` 指向任意内网或非预期 host。

### Task B1: 移除 startup.html inline script

**Files:**
- Modify: `electron/startup.html`
- Optional create/modify through build output only if existing build script requires it.

**Current finding:**
- `electron/startup.html:4` 使用 `script-src 'unsafe-inline'`。
- `electron/startup.html:130-154` 存在内联脚本。

**Implementation options:**
- Preferred: 把脚本移动到外部文件，例如 `electron/startup.js`，并更新 `npm run build:electron` 的复制逻辑，让 `startup.js` 一起进入 `electron/dist/`。
- Alternative: 如果保留单文件启动页，使用 CSP hash；但维护成本更高，不推荐。

**Implementation:**
- [ ] 新增外部 startup 脚本，保持现有 `#state=...&message=...` 行为不变。
- [ ] CSP 改为不包含 `script-src 'unsafe-inline'`，只允许本地外部脚本。
- [ ] 更新 `package.json` 的 `build:electron` 复制逻辑或等价构建步骤。

**Success criteria:**
- 启动页仍能显示 starting/error/stopped 三种状态。
- CSP 不再包含 `script-src 'unsafe-inline'`。

### Task B2: 限制 Skills API base URL

**Files:**
- Modify: `app/api/skills/search/route.ts`
- Add tests if route-level tests pattern exists; otherwise add small unit-testable helper only if needed.

**Current finding:**
- `app/api/skills/search/route.ts:10` 直接使用 `process.env.SKILLS_API_URL || "https://skills.sh"`。
- `app/api/skills/search/route.ts:63-64` 直接 fetch 拼出的 URL。

**Implementation:**
- [ ] 用 `new URL()` 解析 `SKILLS_API_URL`。
- [ ] 只允许 `https:`。
- [ ] 默认只允许 `skills.sh`；如果需要开发覆盖，明确允许 `localhost` / `127.0.0.1` 仅在 `NODE_ENV !== "production"`。
- [ ] 非法 env 值应回退到 `https://skills.sh` 或抛出明确错误；优先选择回退并记录日志，避免生产启动失败。
- [ ] 构造 URL 时使用 `new URL("/api/search", base)` 和 `searchParams`，避免字符串拼接问题。

**Success criteria:**
- 生产环境不能通过 `SKILLS_API_URL` 请求内网 IP、file URL、http URL 或任意第三方域名。
- 默认 skills 搜索行为不变。

**Validation:**
- [ ] `npx tsc --noEmit`
- [ ] `npm run lint`
- [ ] `node --test lib/*.test.ts electron/*.test.ts app/**/*.test.ts`

---

## Batch C: P1-5 port TOCTOU + P1-6 supervised restart

**Goal:** 减少端口选择竞态；Next.js 子进程运行期退出时可控恢复，而不是只显示 stopped。

### Task C1: 简化端口保留逻辑，移除 reachability pre-check

**Files:**
- Modify: `electron/main.ts`
- Modify tests if existing Electron tests cover env only.

**Current finding:**
- `electron/main.ts:108-152` 先 `isPortReachable(port)`，再 `reservePort(port)`，中间存在 TOCTOU。

**Implementation:**
- [ ] 删除 `isPortReachable`，直接尝试 `reservePort(port)`。
- [ ] `reservePort` 成功即返回该端口。
- [ ] `EADDRINUSE` 或其他 listen 失败时尝试下一个端口。
- [ ] 修正 `maxAttempts` 边界：如果默认 10，明确是尝试 10 个端口还是 11 个端口。

**Success criteria:**
- 不再有独立的端口可达性探测步骤。
- 端口被占用时仍能尝试后续端口。

### Task C2: 添加 Next.js 子进程监督重启

**Files:**
- Modify: `electron/main.ts`
- Consider adding targeted tests for pure restart policy helper if extracted.

**Current finding:**
- `electron/main.ts:203-220` 运行期退出后将 `serverState` 设为 `stopped` 并显示停止页，无自动恢复。

**Implementation:**
- [ ] 增加小型 restart policy：仅在 `serverState === "ready"` 且非主动退出时重启。
- [ ] 限制重启次数和时间窗口，例如 3 次 / 60 秒。
- [ ] 重启前复用当前端口或重新找端口；推荐重新找端口，避免端口释放竞态。
- [ ] 重启期间显示 starting 状态；成功后 `showApp(port)`。
- [ ] 超过重启上限后显示 stopped/error，并写日志。

**Success criteria:**
- 启动阶段失败仍显示启动失败。
- 运行期 Next.js 进程异常退出会尝试有限次数恢复。
- 用户主动退出应用不会触发重启。

**Validation:**
- [ ] `npx tsc --noEmit`
- [ ] `npm run lint`
- [ ] `npm run build:electron`
- [ ] `node --test lib/*.test.ts electron/*.test.ts app/**/*.test.ts`

---

## Batch D: P1-7 electron-builder extraResources cleanup

**Goal:** 降低打包配置中手写 npm 依赖列表的维护成本。

**Files:**
- Modify: `electron-builder.yml`
- Possibly modify packaging scripts only if needed.

**Current finding:**
- `electron-builder.yml:16-48` 仍手写复制多个 `node_modules/*` 包。
- 同一文件 `:49-55` 已复制 `.next/standalone` 和 `.next/standalone/node_modules`。

**Implementation options:**
- Preferred: 验证 `electron-updater` 所需运行时依赖能否通过 app 普通 dependencies 或 builder 自动打包，不再逐项列出 transitive packages。
- If manual copy remains necessary: group only direct runtime dependencies, remove transitive dependency list, and document why.

**Implementation:**
- [ ] 运行或检查当前 `npm run pack` 输出，确认哪些包确实需要在 `app/node_modules` 下。
- [ ] 尽量删除 `builder-util-runtime`、`fs-extra`、`graceful-fs` 等 transitive 手写项。
- [ ] 保留 `.next/standalone/node_modules` 的复制项，因为项目说明明确这是必要项。
- [ ] 打包后启动目录版 Electron，确认 updater import 不报 module not found。

**Success criteria:**
- `electron-builder.yml` 不再维护长 transitive dependency 列表。
- `npm run pack` 成功。
- 打包目录版 Electron 可启动。

**Validation:**
- [ ] `npm run pack`
- [ ] 手动启动 release 目录版应用，确认无 module resolution 错误。

---

## Batch E: P1-3 FileViewer large-file rendering

**Goal:** 避免大文件使用 `SyntaxHighlighter` 全量渲染导致 UI 卡顿。

**Files:**
- Modify: `components/FileViewer.tsx`
- Possibly add dependency if virtualized rendering is chosen.

**Current finding:**
- `components/FileViewer.tsx:815-838` 对所有 source 内容直接渲染 `SyntaxHighlighter`。
- `package.json` 当前没有 `@tanstack/react-virtual` 或 `react-window`。

**Implementation options:**
- Option 1: No new dependency. 对超过阈值的文件使用 plain text 分块/行渲染，并禁用语法高亮。
- Option 2: Add `@tanstack/react-virtual` and virtualize line rows. 更完整但会引入依赖和更多实现成本。

**Recommended first pass:**
- 采用 Option 1，不新增依赖。
- 设置明确阈值，例如 `data.content.length > 200_000` 或 `lineCount > 5_000`。
- 大文件显示 lightweight plain text viewer，保留行号、wrap toggle、复制/下载等现有能力。

**Implementation:**
- [ ] 从 `data.content` 派生 `lines` 和 `isLargeSource`，用 `useMemo` 缓存。
- [ ] 小文件继续走现有 `SyntaxHighlighter`。
- [ ] 大文件显示 plain `<pre>` 或行列表，避免 syntax tokenization。
- [ ] UI 上提示“大文件已关闭语法高亮以保持流畅”。
- [ ] 不影响 Markdown preview、HTML preview 和 diff view。

**Success criteria:**
- 小文件视觉基本不变。
- 大文件不会触发 `SyntaxHighlighter` 全量 tokenization。
- Markdown preview、HTML preview、diff view 行为不变。

**Validation:**
- [ ] `npx tsc --noEmit`
- [ ] `npm run lint`
- [ ] `npm run dev`
- [ ] 在浏览器里打开小代码文件、大文本文件、Markdown preview、diff view，确认交互正常。

---

## Suggested branch

Use a single umbrella branch for planning and first implementation pass:

```bash
git switch -c feature/remaining-p1-hardening
```

If implementation becomes too large, split PRs by batch in this order:

1. `feature/p1-a-sse-memo`
2. `feature/p1-b-security-boundaries`
3. `feature/p1-c-electron-supervisor`
4. `feature/p1-d-builder-resources`
5. `feature/p1-e-fileviewer-large-files`
