# P1 剩余项复核 — 2026-06-03

> 基线：`main` @ `ca1ef17`（v0.7.7）· 复核日期：2026-06-03 · 复核人：chasen
>
> 上一次完整评审：`docs/architecture-review-2026-06-01.md`（HEAD `7e97e2a`，v0.7.6）。
> 本文是它的 **P1 专项复核**——逐项用 Read/Grep 在当前 `main` 上重新核对位置、问题是否仍成立、修复方向是否需要更新，并指出 P0 重构（P0-5 / P0-6 / P0-3）造成的行号漂移。
>
> **范围**：P1-2 至 P1-10（P1-1 已合入 PR #2，§2 见原评审）。
>
> **方法**：每个 P1 项用 2-3 个 Read/Grep 复核当前代码；不重跑测试或启动 dev server。
>
> **图例**：🟢 仍成立 · 🟡 仍成立但需调整（行号 / 上下文漂移）· 🔴 已不需要 / 被新代码吸收 · ✅ 已完成（不在本范围）

---

## 0. 摘要

| 项 | 标题 | 06-01 状态 | 06-03 复核 | 主要变化 |
|---|---|---|---|---|
| P1-2 | SSE `JSON.parse` 静默吞 | 🟡 | 🟡 | 文件从 `hooks/useAgentSession.ts:226-228` 移到 `hooks/agent-session/use-agent-events.ts:35-42`（P0-6 重构）；catch 块仍是 `/* ignore */` |
| P1-3 | FileViewer 大文件无虚拟滚动 | 🟡 | 🟢 | 位置未漂（`components/FileViewer.tsx:815-838`）；项目仍未引入 `@tanstack/react-virtual` |
| P1-4 | URL ↔ React 状态用 `suppressCwdBumpRef` 互抑制 | 🟡 | 🟢 | 位置漂到 `components/AppShell.tsx:162, 167, 195-196`；问题性质未变 |
| P1-5 | 端口扫描 TOCTOU 竞争 | 🟡 | 🟢 | 位置漂到 `electron/main.ts:107-152`（`findFreePort` 整段）；竞争窗口 140→145 |
| P1-6 | Next.js 进程崩溃无自动恢复 | 🟡 | 🟢 | 位置漂到 `electron/main.ts:196-213`（`handleNextProcessExit`）；行为未变 |
| P1-7 | `electron-builder.yml` `extraResources` 手写 | 🟡 | 🟢 | 列表 19 项（`electron-builder.yml:17-49`）原样保留；只多了对 `node_modules` 整体的第二项 `extraResources`（55-58），但前 19 项依然手写 |
| P1-8 | `startup.html` CSP `script-src 'unsafe-inline'` | 🟡 | 🟢 | 位置漂到 `electron/startup.html:5`（head meta）；内联脚本仍在 131-155 |
| P1-9 | `SKILLS_API_URL` 改 env 后变 SSRF | 🟡 | 🟢 | 位置漂到 `app/api/skills/search/route.ts:11`（`SEARCH_API_BASE`）+ `:65`（fetch）；无 allowlist |
| P1-10 | 派生值未 memo | 🟡 | 🟢 | 位置漂到 `hooks/useAgentSession.ts:101`（`currentModel`）、`:104`（`sessionStats` → `calculateSessionStats(messages)`）；仍无 `useMemo` 包裹 |

**结论**：9 个 P1 项**全部仍成立**，且都因为 P0 重构而需要重新核对行号。无新增风险，无 P1 范围"自然解决"的项。

**推荐的实施批次**（按收益 / 工作量 / 互相阻塞）：

1. **P1-4 + P0-4 合批**：URL 状态去 `suppressCwdBumpRef` + 5 处 env 透传白名单化（已确认 2 处主进程，详见 §10）。
2. **P1-7 + follow-up #1（electron-updater 缺模块）**：一起改 `electron-builder.yml` 资源复制策略。
3. **P1-6**：Next.js 进程 supervisor，独立小改动。
4. **P1-10**：低风险高收益，单独一个 PR。
5. **P1-2 / P1-8 / P1-9**：安全 / 可观测性补丁，可与 P2-1（pino）一起做。
6. **P1-3 / P1-5**：前端性能 / 启动 race，独立处理。

---

## 1. P1-2. SSE `JSON.parse` 失败被静默吞掉

**位置**：`hooks/agent-session/use-agent-events.ts:35-42`

> 06-01 评审时位于 `hooks/useAgentSession.ts:226-228`。P0-6 重构（`c1d68cd`）把 SSE handler 拆出到独立 hook 文件，代码形态未变。

**当前代码**：
```ts
// hooks/agent-session/use-agent-events.ts:35-42
es.onmessage = (e) => {
  try {
    const event = JSON.parse(e.data) as AgentEvent;
    handleAgentEventRef.current?.(event);
  } catch {
    // ignore
  }
};
```

**问题**：pi 后端任何一次返回非 JSON（HTML 错误页、proxy 拦截、序列化中途断开）都会被静默丢弃，UI 表现为"agent 卡住但无错误"。Dev 环境用户只能看到 console 里 `// ignore` 后面没有 stack。

**修复方向**（与 06-01 评审一致，未变）：
- dev 模式至少 `console.warn("[SSE] malformed event", e.data, err)`，附 stack。
- prod 环境走 P2-1 的 `pino` 通道（结构化 `level: "warn", kind: "sse.malformed", raw: e.data.slice(0, 200), requestId }`）。
- 可选：把 `requestId` 从事件里提取（如果 pi 端有），用于跨进程 trace。

**额外建议**：拆 SSE handler 时也拆错误处理——把 `onerror` 里的 `reconnectTimer` 逻辑也走 `logError`/`logWarn`，目前 `:43-52` 也是 `//` 注释，dev 不可见。

---

## 2. P1-3. `FileViewer` 大文件无虚拟滚动

**位置**：`components/FileViewer.tsx:815-838`（`SyntaxHighlighter` 渲染块），文件总长 843 行。

**当前代码**（节选）：
```tsx
// components/FileViewer.tsx:815-838
<SyntaxHighlighter
  language={data.language === "text" ? "plaintext" : data.language}
  style={isDark ? ayuDarkSyntaxTheme : ayuLightSyntaxTheme}
  showLineNumbers
  ...
>
  {data.content}
</SyntaxHighlighter>
```

**问题**：
- `SyntaxHighlighter` 全量渲染：5000 行文件每次 React render 重新 tokenize + 主题应用 + DOM 挂载，Tab 切换或 theme 切换会卡几百 ms。
- 没有任何文件大小 / 行数判断——即便用户打开一个 5MB 的日志也是直接全量。
- 项目里**没有** `@tanstack/react-virtual` 依赖（`package.json` 已确认）。

**修复方向**（与 06-01 一致，未变）：
- 行数 > 1000 启用虚拟滚动（`@tanstack/react-virtual`），把行切成固定行高的 `LineRow`，`useVirtualizer` 渲染可见窗口。
- 文件 > 256KB 给"以原始文本查看"选项，跳过高亮。
- 难度在于 `react-syntax-highlighter` 的 tokenize 输出和虚拟滚动的对齐——可以只对纯文本 / markdown 启用虚拟滚动（无 tokenize），对代码高亮保持原样但加"折叠到顶部 N 行"。

**验证建议**：用 1k / 5k / 20k 行的 `node_modules/typescript/lib/typescript.d.ts`（ts 声明文件）做基准，肉眼对比切换延迟。

---

## 3. P1-4. URL 状态 ↔ React 状态用 `suppressCwdBumpRef` 互相抑制

**位置**：`components/AppShell.tsx:162, 167, 195-196`（`suppressCwdBumpRef` 定义 + 三处使用）

> 06-01 评审时为 `components/AppShell.tsx:164-184`、`components/SessionSidebar.tsx:254-259`。P0-5 期间小幅调整过数字，但模式未变。

**当前代码**：
```tsx
// AppShell.tsx:161-162
// Suppresses sessionKey bump in handleCwdChange during the initial URL restore
const suppressCwdBumpRef = useRef(false);

// AppShell.tsx:164-167
const handleCwdChange = useCallback((cwd: string | null) => {
  setActiveCwd(cwd);
  // Skip if cwd is null (initial mount) or during the initial URL restore.
  if (!cwd || suppressCwdBumpRef.current) return;
  ...

// AppShell.tsx:195-196
suppressCwdBumpRef.current = true;
setTimeout(() => { suppressCwdBumpRef.current = false; }, 0);
```

**问题**（与 06-01 一致）：
- 典型"打补丁式状态同步"——Sidebar 的 `setSelectedCwd` → `onCwdChange` effect（`SessionSidebar.tsx:274-275`）→ AppShell `handleCwdChange` → `router.replace` → URL 变 → Sidebar 重新 render → `setSelectedCwd` 再次触发。`suppressCwdBumpRef` 是给这个循环贴的胶带。
- `setTimeout(..., 0)` 是 hack：依赖 microtask 调度顺序保证 setState 提交后再清旗。任何升级到 React 18+ concurrent 模式都可能破坏。
- AppShell 已经 import 了 `useSearchParams`（`:4, :25`），但**没有**用作 single source of truth——仍然是双向状态。

**修复方向**（与 06-01 一致）：
- AppShell 作为 URL 的 **single source of truth**：
  - 维护 `activeCwd: string | null`，**只**由 `useSearchParams` 派生的 effect 写入。
  - `router.replace(\`?cwd=${encodeURIComponent(cwd)}\`)` 写入 URL，effect 读 URL 推 state。
- Sidebar 只发 action（`onCwdChange` 回调），不读 URL。
- `SessionSidebar` 的 `selectedCwd` 内部 state 改用 `useSyncExternalStore` 模式或直接改为受控组件（接 `selectedCwdProp`）。
- 删除 `suppressCwdBumpRef` + `setTimeout` + `if (suppressRef.current) return` 全部三处。

**额外建议**：把 P0-4 合并到这个 PR 处理——`AppShell` 重构过程中会触碰 `router.replace`，顺手把 2 处 env 透传白名单化（`main.ts:165, 180-185`），详见 §10。

---

## 4. P1-5. 端口扫描 TOCTOU 竞争

**位置**：`electron/main.ts:107-152`（`isPortReachable` + `reservePort` + `findFreePort`）

> 06-01 评审时为 `electron/main.ts:136-152`。函数结构未变，但 `isPortReachable` / `reservePort` 略有调整。

**当前代码**（关键竞争窗口）：
```ts
// main.ts:140-148（findFreePort 主循环）
if (await isPortReachable(port)) {     // ← L140: 检查通过
  continue;
}
try {
  return await reservePort(port);      // ← L145: 真去 listen（无原子保证）
} catch {
  // Try next port.
}
```

**问题**（与 06-01 一致）：
- `isPortReachable` 用 `net.connect` 试连（成功=被占用），`reservePort` 用 `net.createServer().listen` 抢端口。两者之间有窗口，另一进程可能在 `connect → end` 之后、`listen` 之前抢走。
- 实际触发概率低（dev 模式 30141 端口冲突少见），但 v0.7.7 用户基数增长后预计会出现。

**修复方向**（与 06-01 一致）：
- 跳过 `isPortReachable`——直接 `reservePort`，成功即代表端口可用，失败换下一个。
- 优化后的 `findFreePort`：
  ```ts
  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    const port = startPort + attempt;
    try { return await reservePort(port); } catch { /* next */ }
  }
  ```
- 可选：连续 N 次失败后扩到 30142-30152，而不是直接抛错（用户提示"端口全忙，请关闭其他 dev server"）。

**测试建议**：mock `net.createServer` 在 `listen` callback 之前抛 EADDRINUSE，断言循环换到下一个端口。当前 `electron/server-wait.test.ts` 已有部分覆盖，需补 race 场景。

---

## 5. P1-6. 启动后 Next.js 进程崩溃无自动恢复

**位置**：`electron/main.ts:196-213`（`handleNextProcessExit`）

> 06-01 评审时为 `electron/main.ts:205-213`。函数体未变。

**当前代码**：
```ts
// main.ts:196-213
function handleNextProcessExit(label: string, code: number | null, signal: NodeJS.Signals | null) {
  logInfo(`${label} exited`, { code, signal, serverState, isQuitting });

  if (isQuitting || serverState === "stopped") {
    return;
  }

  nextProcess = null;

  if (serverState === "starting") {
    serverState = "stopped";
    showStartupState("error", "本地服务启动失败");
    return;
  }

  serverState = "stopped";
  showStartupState("stopped", "本地服务进程已退出");
}
```

**问题**（与 06-01 一致）：
- 启动后任何时刻进程退出都只是 `serverState = "stopped"` + 改 `startup.html` 的提示。生产环境短暂端口冲突让用户必须手动重启整个 app。
- 状态机缺少 `supervised` 阶段，错误恢复逻辑分散在 `startup-failure.ts`（仅分析不恢复）。

**修复方向**（与 06-01 一致）：
- 引入 supervisor 状态机：`starting → ready → supervised`：
  - `ready` 期间首次成功 `loadURL` 后切到 `supervised`。
  - `supervised` 状态下 `handleNextProcessExit` 触发指数退避重试（1s / 2s / 4s / 8s / 16s，封顶 30s），最多 3 次。
  - 重试用完切回 `error` 状态 + 弹"重试"按钮（前端 `startup.html` 改 hash）。
- 重试时复用已分配的 `activePort`（用户期望端口不变）。

**测试建议**：mock `proc.on("exit", ...)` 触发，断言 `findFreePort` + `startNextServer` 被再次调用，端口不变。`electron/startup-failure.test.ts` 可扩展。

---

## 6. P1-7. `electron-builder.yml` 的 `extraResources` 列表手工维护

**位置**：`electron-builder.yml:17-49`（19 个手写包），`:55-58`（`.next/standalone/node_modules` 整体复制作为第二项）

> 06-01 评审时为 `electron-builder.yml:50-56`。列表前移是因为 06-02 加了 `electron-updater` 自动更新模块。但手写包列表原样保留——follow-up #1（`electron-updater` 启动 30s 报 `Cannot find module`）就是因为列表不全。

**当前代码**（节选）：
```yaml
# electron-builder.yml:17-49
extraResources:
  - from: node_modules/electron-updater
    to: app/node_modules/electron-updater
  - from: node_modules/builder-util-runtime
    to: app/node_modules/builder-util-runtime
  - from: node_modules/fs-extra
    to: app/node_modules/fs-extra
  ...  # 共 19 个手写条目
  - from: node_modules/ms
    to: app/node_modules/ms
  - from: .next/standalone
    to: standalone
    filter: ["**/*", "!node_modules/**/*"]
  - from: .next/standalone/node_modules
    to: standalone/node_modules
  - from: .next/static
    to: standalone/.next/static
  - from: public
    to: standalone/public
```

**问题**（与 06-01 一致，但**更严重**）：
- 19 个 npm 包手写，漏一个就 `Cannot find module`。`electron-updater` 升级、新增 `diff` 类依赖等都会让列表过时。
- 当前额外问题：`.next/standalone` 复制时**显式排除** `node_modules`（`:14` 的 `filter: ["**/*", "!node_modules/**/*"]`），然后又把整个 `node_modules` 作为第二项复制——**这俩冲突**，第二项会**覆盖**第一项的目录结构。
- follow-up #1 提到的 `electron-updater` 30s `Cannot find module` 即是此问题：依赖图里还有 `debug`、`sax`、`ms` 等传递依赖，目前都在 19 项列表里手工维护。

**修复方向**（与 06-01 一致）：
```yaml
extraResources:
  - from: .next/standalone
    to: standalone
    filter: ["**/*", "!node_modules/**/*"]
  - from: .next/standalone/node_modules
    to: standalone/node_modules
  - from: .next/static
    to: standalone/.next/static
  - from: public
    to: standalone/public
  # 不再手写 electron-updater 的传递依赖
```
让 electron-builder 自己解析整个 `standalone/node_modules` 树，删掉 19 项手写列表。

**额外建议**：
- 引入 `asarUnpack` 处理 `logs/` / `config/` 等可写目录。
- 加 `scripts/check-resources.js` 启动时校验 `process.resourcesPath/standalone/node_modules/electron-updater` 存在，缺则提示"打包资源不完整"。

**风险**：从 `electron-packager --ignore` 切回 `electron-builder` 是大改动，建议**先**用 `electron-builder` 跑 dry-run（不实际生成 installer，只生成目录）验证 `extraResources` 树完整，再切 release pipeline。

---

## 7. P1-8. `startup.html` 的 CSP 是 `script-src 'unsafe-inline'`

**位置**：`electron/startup.html:5`（CSP meta），`:131-155`（内联脚本）

> 06-01 评审时为 `electron/startup.html:133`。meta 标签移到 head 顶部。

**当前代码**：
```html
<!-- startup.html:5 -->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
...
<!-- startup.html:131-155 -->
<script>
  (function () {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    var state = params.get("state");
    var message = params.get("message");
    ...
  })();
</script>
```

**问题**（与 06-01 一致）：
- CSP 允许内联脚本。当前 IIFE 用 `textContent`（安全）写文案，没有 `innerHTML` / `eval` / `Function(...)`，但纵深不足——任何后续"加个动态状态"的需求（用 `innerHTML` 显示详细错误）会引入 XSS。
- `style-src 'unsafe-inline'` 同理——目前用 `:root { ... }` 静态 CSS，未来加 dynamic style 会同样踩坑。
- 加载方式是 `loadFile`（`file://` 协议），CORS 不严格，相对 `protocol: file` 的 `script-src 'self'` 实测有效。

**修复方向**（与 06-01 一致）：
- 拆出 `startup.js`：在 `electron/startup.html` 同目录放 `startup.js`，IIFE 内容挪过去。
- CSP 改为 `script-src 'self'; style-src 'self'`，内联 `<style>` 用 `<link rel="stylesheet" href="startup.css">` 替换。
- 同步更新 `electron-builder.yml` 的 `files` 列表把 `startup.html` + `startup.js` + `startup.css` 一起打包。

---

## 8. P1-9. `SKILLS_API_URL` 改 env 后可能变 SSRF

**位置**：`app/api/skills/search/route.ts:11`（`SEARCH_API_BASE`）、`:65`（fetch）

> 06-01 评审时为 `:63`。代码略有重构（加 `parseLimit` / `formatInstalls` 等辅助函数），env 读取位置前移。

**当前代码**：
```ts
// route.ts:11
const SEARCH_API_BASE = process.env.SKILLS_API_URL || "https://skills.sh";
...
// route.ts:63-66
async function searchSkillsApi(query: string, limit: number): Promise<SkillSearchResult[]> {
  const url = `${SEARCH_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`skills.sh search failed: HTTP ${res.status}`);
  ...
}
```

**问题**（与 06-01 一致）：
- `SKILLS_API_URL` 默认是 `https://skills.sh`，但 env 变量没有校验。攻击者通过某种途径修改（共享电脑、CI 注入、`dotenv` 误提交）会变成任意 URL → SSRF。
- 即便目标是公网，攻击者可以指向 `http://localhost:30141/api/...` 探测内网（next dev 端口也是 localhost），或指向 `http://169.254.169.254/...`（云元数据端点）。
- `fetch` 走 Next.js server runtime，DNS 解析 + TCP 连接都在服务端。

**修复方向**（与 06-01 一致）：
- 启动时校验 env：
  ```ts
  const ALLOWED_HOSTS = ["skills.sh", "staging.skills.sh"];
  const parsed = new URL(SEARCH_API_BASE);
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.includes(parsed.hostname)) {
    throw new Error(`Invalid SKILLS_API_URL: ${SEARCH_API_BASE}`);
  }
  ```
- 抛错时机放在模块加载时（`route.ts` 顶部），让 `npm run dev` 启动直接 fail-fast。
- 同步修 `app/api/skills/install/route.ts`（如果有类似的 env 读取）。

---

## 9. P1-10. 派生值未 memo

**位置**：`hooks/useAgentSession.ts:101`（`currentModel`）、`:104`（`sessionStats`）

> 06-01 评审时为 `:131, 134-149`。P0-6 重构后行号前移。

**当前代码**：
```ts
// useAgentSession.ts:101
const currentModel = currentModelOverride ?? data?.context.model ?? pendingModel ?? null;
// useAgentSession.ts:104
const sessionStats = calculateSessionStats(messages);
```

**调用方**（`:539`）：
```ts
return { ..., isCompacting, compactError, currentModel, displayModel, sessionStats, ... };
```

**问题**（与 06-01 一致）：
- `currentModel` 是 3 个值的 `??` 链，每次 render 都新建对象引用——`React.memo` 包裹的子组件（如果有）拿到的 prop 引用每次都变，memo 失效。
- `sessionStats = calculateSessionStats(messages)` 遍历整个 messages 数组计算 token 统计，每次 render 重新算。
- 整个组件本身没被 `React.memo` 包裹，但返回的 `currentModel` / `sessionStats` 给 `MessageList` / `ChatWindow` 用——`MessageList` 是 P0-5 期间提取的，可能下游有 prop 依赖。

**修复方向**（与 06-01 一致）：
- `currentModel` 包 `useMemo`：
  ```ts
  const currentModel = useMemo(
    () => currentModelOverride ?? data?.context.model ?? pendingModel ?? null,
    [currentModelOverride, data?.context.model, pendingModel],
  );
  ```
- `sessionStats` 包 `useMemo`：
  ```ts
  const sessionStats = useMemo(() => calculateSessionStats(messages), [messages]);
  ```
- `displayModel = isNew ? newSessionModel : currentModel` 也是派生，可一起 memo。
- `currentModel` 的 dep `data?.context.model` 是对象读取，TS 不会自动 narrow 为稳定引用——可能需要 `data?.context?.model` 或在 `data` 变化时整体 invalidate。

**测试建议**：用 React Profiler 跑 P0-5 留下的 1000 消息场景（如果补了测试），断言 memo 后 render 次数下降。当前无回归测试。

---

## 10. P0-4 / P1-4 合批建议 — env 透传白名单化

**位置**：`electron/main.ts:165`（dev spawn）、`:180-185`（packaged spawn）

> 06-01 评审推测"5 处 env 透传"，本次复核**确认 2 处**在主进程。其他 3 处（electron-builder / 测试 / Electron 自身 env）不在主进程 spawn 路径上，不属于"运行时透传"风险。

**当前代码**：
```ts
// main.ts:165（dev spawn next dev）
env: { ...process.env, PORT: String(port) },

// main.ts:180-185（packaged spawn standalone server.js）
env: {
  ...process.env,
  ELECTRON_RUN_AS_NODE: "1",
  PORT: String(port),
  HOSTNAME: "127.0.0.1",
},
```

**风险**（与 06-01 一致）：
- `ELECTRON_*`、`npm_config_*`、`VSCODE_*` 等 Electron 内部 env 暴露给 Next.js dev server，可能影响 dev 行为（比如 `npm_config_*` 会被 Next.js telemetry 模块读取）。
- 用户环境里的 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 在 dev 模式是**需要的**（pi-coding-agent 读），不能简单剥掉。

**修复方向**（与 06-01 一致）：
```ts
// main.ts:165（dev spawn）
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: String(port),
  NEXT_TELEMETRY_DISABLED: "1",
  ...pickApiKeys(process.env),  // ANTHROPIC_API_KEY, OPENAI_API_KEY, pi 需要的其他
};

// main.ts:180-185（packaged spawn）
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  NODE_ENV: process.env.NODE_ENV ?? "production",
  PORT: String(port),
  HOSTNAME: "127.0.0.1",
  ELECTRON_RUN_AS_NODE: "1",
  ...pickApiKeys(process.env),
};
```

**实施细节**：
- `pickApiKeys(env)` 是单文件工具函数，定义在 `electron/main.ts` 顶部：
  ```ts
  function pickApiKeys(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PI_*"];  // 根据 pi-coding-agent 实际读取的 env
    const out: NodeJS.ProcessEnv = {};
    for (const k of keys) {
      if (k.endsWith("*")) {
        const prefix = k.slice(0, -1);
        for (const [ek, ev] of Object.entries(env)) {
          if (ek.startsWith(prefix)) out[ek] = ev;
        }
      } else if (env[k]) {
        out[k] = env[k];
      }
    }
    return out;
  }
  ```
- 同步修 `electron/server-wait.ts` / `electron/process-tree.ts` 如果有 spawn 调用。

**测试**：用 `process.env` 注入 `ELECTRON_TEST_VAR=evil` + `ANTHROPIC_API_KEY=sk-...` 然后 spawn，断言子进程 `process.env.ELECTRON_TEST_VAR === undefined` + `ANTHROPIC_API_KEY` 保留。

---

## 11. 与 follow-up 的关系

| follow-up | 涉及 P1 | 关系 | 建议合并 |
|---|---|---|---|
| #1 `electron-updater` 30s 报 `Cannot find module` | P1-7 | 直接因手写列表不全导致 | 合 P1-7 一个 PR |
| #2 `node --test` glob 未覆盖 `hooks/**` | — | P0-6 留的测试覆盖盲区，独立修 | 单 PR |
| #3 Windows .exe 需手工拷贝 `.next/static/` | P1-7 | electron-packager 不复制 static | 合 P1-7 一个 PR |
| #4 P0-5 性能回归测试未补 | P1-10 | 同属 React 渲染优化 | 一起加 React Profiler 快照 |
| #5 P0-4 dev env 透传 | P1-4 | 完全合批 | 合 P1-4 一个 PR |
| #6 P1-1 客户端未消费 `x-request-id` | — | P1-1 留的 API 客户端补丁 | 单独修 `lib/agent-client.ts` |

---

## 12. 评审方法

- **9 个 P1 项**全部用 Read 或 Grep 在 `ca1ef17` 上重新核对（行号 / 代码形态 / 修复方向是否仍适用）。
- **目录结构**确认：`hooks/agent-session/*`（P0-6 拆出）、`components/MessageList.tsx` + `components/MessageView.tsx`（P0-5 拆出）。
- **依赖确认**：`package.json` grep — `husky` / `lint-staged` / `@tanstack/react-virtual` 均无。
- **未跑**：`npm test` / `npm run build` / 启动 dev server——纯静态复核。
- **行号基准**：所有行号以 `ca1ef17` 为准，CI 后可能漂 1-2 行。

## 13. 实施日志（2026-06-03）

- **2026-06-03** 形成本复核文档（`docs/p1-followup-review-2026-06-03.md`）。
- **2026-06-03** 切换工作树到 `main` 时发现过期 worktree 注册 `D:/orca/pi-agent-desktop/main`（路径已不存在），执行 `git worktree prune` 清理。
- **2026-06-03** 删除 `feature/p1-1-api-error-handling` 本地与远程分支（P1-1 全部工作已合入 main，PR #2）。

**当前分支**：`main` · **HEAD**：`ca1ef17`（v0.7.7）· **下一阶段**推荐：P1-4 + P0-4 合批（URL 状态去 `suppressCwdBumpRef` + env 透传白名单化），独立小改动且能解掉 follow-up #5。
