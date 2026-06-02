# Pi Agent Desktop 架构优化评审

> 分支：`analysis/architecture-optimization-review` · 日期：2026-06-01 · 基准提交：`1a33476`
>
> 本文档是对当前架构的深度扫描结果，按"必改 / 应该改 / 锦上添花"分级。每条发现都给出位置、问题、修复方向、严重性。所有行号以基准提交为准，文件后续修改后会漂移。
>
> **使用方式**：从 P0 开始逐条消化；改动 P0 时同步补齐对应测试。修复示例仅给出形状，不要照抄——结合实际上下文再定。

---

## 0. 摘要

| 严重性 | 数量 | 类别 |
|---|---|---|
| 🔴 P0 必改 | 6 | 数据丢失 / 崩溃 / 安全 |
| 🟡 P1 应该改 | 10 | 性能 / 可维护性 / 可发布性 |
| 🟢 P2 锦上添花 | 6 | DX / 一致性 / 可观测性 |
| 📋 建议重构项 | 3 | 跨文件、需 1 周以上 |

**最大风险**：

1. **JSONL 文件无写锁** — DELETE 操作会静默损坏子会话 header。
2. **10 分钟 idle timer 与 SSE heartbeat 解耦** — 长思考模型下会误杀 session。
3. **fork / navigate_tree 是隐式 fire-and-forget** — 状态时序无显式契约。

---

## 1. P0 — 必改

### P0-1. JSONL 写并发无锁，DELETE 级联重写必然损坏

**位置**：`app/api/sessions/[id]/route.ts:122-141`

**问题**：DELETE 会扫描同目录下所有 `.jsonl` 文件，对每个 `parentSession === filePath` 的子文件做 `readFileSync → JSON.parse → mutate header → writeFileSync`。两个并发 DELETE（删父 + 删子，或两个子）会交叉覆盖；同一文件被两个请求同时改写时，后写的完全丢失前写的结果。

**当前代码**（核心片段）：
```ts
// route.ts:126-140
for (const file of files) {
  const childPath = join(dir, file);
  const content = readFileSync(childPath, "utf8");
  const lines = content.split("\n");
  const header = JSON.parse(lines[0]) as { ... };
  if (header.type === "session" && header.parentSession === filePath) {
    header.parentSession = parentSessionPath;
    lines[0] = JSON.stringify(header);
    writeFileSync(childPath, lines.join("\n"));  // ← 无锁
  }
}
```

**修复方向**：
- 在 `globalThis` 上加写锁 `Map<sessionPath, Promise>`，对同一文件的所有写入串行化。
- 收集所有要重写的 child 路径到内存，先全部读完解析，最后用 `fs.promises.writeFile` + tmp + rename 原子替换每个文件。
- 严格：子文件的 `parentSession` 是绝对路径，DELETE 时**先**把父文件 unlink，再批量改 child header，最后再处理 parentSession 路径失效的 child——避免"重写后又被父路径失效"的中间态。

**建议测试**：
- 模拟并发 N 个 DELETE 同一父 + 多个子，断言所有 child header 最终一致。
- 模拟父文件先 unlink 再批量重写 child，断言无 race。

---

### P0-2. 10 分钟 idle timer 与 SSE heartbeat 解耦，长任务被误杀

**位置**：`lib/rpc-manager.ts:50-53`、`app/api/agent/[id]/events/route.ts`（heartbeat）

**问题**：`resetIdleTimer()` 只在 `subscribe` 回调（收到 pi 真实事件）时触发。SSE heartbeat 发的是 `:\n\n` comment frame，不会触发 `subscribe`，因此 timer 不会被重置。agent 等 LLM 响应超过 10 分钟（Opus thinking、长时间工具执行）→ session 被销毁 → SSE 断流 → 用户看到"连接已断开"，需手动重连。

**当前代码**：
```ts
// rpc-manager.ts:42-48
start(): void {
  this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
    this.resetIdleTimer();
    for (const l of this.listeners) l(event);
  });
  this.resetIdleTimer();
}
```

**修复方向**（任选一种）：
- **A. heartbeat 重置 timer**：在 SSE route 里发 heartbeat 时调用 `session.keepAlive()`，wrapper 暴露 `keepAlive()` 只 reset timer。
- **B. 双向 timer**：把 idle timer 改为"仅在 SSE 断开时启动"——只要有连接就保持 session 存活。理由：SSE 断开意味着用户不再关心这个 session，10 分钟是合理的回收时间。
- **C. 把 timer 延长到 30 分钟 + 增加 LLM 响应计时器**：长思考模型是已知场景，硬编码 10 分钟偏短。

**建议测试**：
- 模拟连续 11 分钟只有 heartbeat（无业务事件），断言 wrapper 仍 alive。
- 模拟 SSE 断开 11 分钟后，断言 wrapper 被销毁。

---

### P0-3. fork / navigate_tree 的状态时序是隐式契约

**位置**：`lib/rpc-manager.ts:113-143`（fork）、`hooks/useAgentSession.ts:431-447`（navigate）

**问题**：
- `fork` 命令末尾 `this.destroy()` 立即触发 `onDestroyCallback → registry.delete(realSessionId)`，但 `newSessionId` 对应的新 session 此时还没在注册表里（要等 UI 收到响应后主动 `startRpcSession(newSessionId)`）。中间窗口里如果 UI 已用 `newSessionId` 发请求，会落到"重新创建"路径，绕过 pi 的 fork 状态。
- `navigate_tree` 是 fire-and-forget，UI 立即 `setActiveLeafId(entryId)` + `loadContext(sid, entryId)`，但 navigate 命令本身可能失败（被 pi 拒绝），UI 显示的 leafId 和 agent 实际状态会不一致。

**当前代码**：
```ts
// rpc-manager.ts:140-143 (fork)
const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
cacheSessionPath(newSessionId, newSessionFile);
this.destroy();   // ← 立即销毁
return { cancelled: false, newSessionId };

// useAgentSession.ts:434-436 (navigate)
sendAgentCommand(sid, { type: "navigate_tree", targetId: entryId }).catch(() => {});
setActiveLeafId(entryId);
await loadContext(sid, entryId);
```

**修复方向**：
- 引入**命令确认事件**：命令 send → 收到 `command_ack` 事件 → UI 才更新。`fork` 拆成两步：先 `prepare_fork` 拿到 newSessionId 并预先注册，再 `commit_fork` 销毁旧 wrapper。中间状态对 UI 透明。
- 或者更轻量：在 fork 返回前 await `cacheSessionPath` 落盘，并主动 `startRpcSession(newSessionId, newFile, cwd)` 把新 wrapper 注册好（这样销毁旧的同时新已在册）。
- `navigate_tree` 改为 `await` + 失败时回滚 `setActiveLeafId` 到旧值。

**建议测试**：
- 模拟 fork 后立即用 newSessionId 发请求，断言不重新创建。
- 模拟 navigate_tree 失败，断言 UI leafId 回滚。

---

### P0-4. dev 模式 `process.env` 全量透传给 Next.js 子进程

**位置**：`electron/main.ts:158`（推测行号，需要核对）

**问题**：`env: { ...process.env, PORT: String(port) }` 把 Electron 进程的所有环境变量透传给 Next.js dev server。`ELECTRON_*`、`npm_config_*` 暴露给 Next.js 会影响 dev server 行为，且泄露 Electron 内部状态。

**修复方向**：
```ts
env: {
  PORT: String(port),
  NODE_ENV: process.env.NODE_ENV ?? "development",
  NEXT_TELEMETRY_DISABLED: "1",
  ELECTRON_RUN_AS_NODE: "1",  // 显式保留需要的
  // 显式放行 pi / OpenAI / Anthropic API key 等
  ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
}
```

**建议测试**：
- 启动 dev electron 子进程，断言 Next.js 进程 env 中不含 `npm_config_*`、`ELECTRON_*`（除显式白名单）。

---

### P0-5. ChatWindow 每帧 O(n) 重渲染，长对话卡顿

**位置**：`components/ChatWindow.tsx:295-353`

**问题**：在 `messages.map` 上包了一个 IIFE，每次 render 重新：
- 建 `toolResultsMap`（O(n)）
- 反向扫描找 last user（O(n)）
- 对每条消息 forward scan 找下个 user/assistant（O(n) inside O(n) = O(n²) worst case）
- 用 `idx` 作 key 触发整列 unmount/remount

**当前代码**（节选）：
```tsx
{(() => {
  const toolResultsMap = new Map<string, ToolResultMessage>();
  for (const msg of messages) { ... }   // O(n)
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) { ... }  // O(n)
  return messages.map((msg, idx) => {  // O(n) × O(n) = O(n²)
    // ...
  });
})()}
```

**修复方向**：
- 抽 `MessageList` 组件，用 `useMemo` 计算 `toolResultsMap` 和 `lastUserIdx`。
- 给 `MessageView` 套 `React.memo`，key 改用 `entryIds[idx]`（稳定 ID 而非 index）。
- 内部状态（tool calls 展开、diff 展开）放到 `MessageView` 自己管理。
- forward scan 改为预计算 `nextUserIdx[]` / `nextAssistantIdx[]` 的 Map。

**建议测试**：
- 用 React Profiler 记录 1000 条消息的 render 时间，断言优化后 < 16ms。
- 滚动时无重新 mount 警告。

---

### P0-6. `useAgentSession.ts` mount effect 无依赖 + `eslint-disable`

**位置**：`hooks/useAgentSession.ts:559-584`

**问题**：mount effect 用 `eslint-disable-next-line react-hooks/exhaustive-deps` 强制压制。`session` prop 从 A→B（组件未卸载）时：旧 session 的 SSE 不会被关闭（cleanup 只在 unmount 触发），新的 `connectEvents(session.id)` 在 EventSource 已存在时不会自动重连（`useCallback` 内部检查 `eventSourceRef.current` 才会 close 旧的，但新调用可能直接走 else 分支）。

AppShell 靠 `sessionKey` 强制 remount 掩盖这个 bug——是**隐性契约**，未来加新 prop 必然踩坑。

**当前代码**：
```ts
useEffect(() => {
  if (session) {
    sessionIdRef.current = session.id;
    loadSession(session.id, true, true).then((agentState) => { ... });
  }
  return () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

**修复方向**：
- 把 `session?.id` 加进 deps。Effect 内部用 `session.id` 而不是闭包变量。
- `connectEvents` 内部已经检查 `eventSourceRef.current` 并 close，直接调用即可，无需额外清理逻辑。
- 移除 `eslint-disable`——CLAUDE.md 提到的"显式关闭三条 react-hooks 规则"应逐条评估必要性，能开的就开。

**建议测试**：
- 模拟 `session` prop 从 A→B，断言旧 EventSource 被关闭、新 EventSource 已建立。
- 模拟 `session` 从 A→null，断言 EventSource 被关闭、无 in-flight loadSession 副作用。

---

## 2. P1 — 应该改

### P1-1. `lib/normalize.ts` 用了 `as` 断言 + API catch 返回 `String(error)`

**位置**：`lib/normalize.ts:23, 29`、`app/api/agent/[id]/route.ts:34-35`、`app/api/sessions/[id]/route.ts:74-75, 97-98, 147-148`

**问题**：
- `normalizeToolCalls` 接收 `Partial<AgentMessage>` 然后 `as AssistantMessage` 强制断言，运行时类型不匹配会静默错乱。
- API route 的 `catch (error) { return NextResponse.json({ error: String(error) }) }` 丢 stack、丢上下文，调试只能看客户端 console。

**修复方向**：
- `normalize.ts` 入口加 zod schema 或运行时类型守卫（`isAssistantMessage(msg: AgentMessage): msg is AssistantMessage & { ... }`）。
- API catch 统一走 `logError(err, { route, params })` 写结构化日志（用项目里已有的 `writeLog`），response 返回 `{ error: { code, message, requestId } }`。
- 引入 `requestId` middleware（`x-request-id` header），日志和响应贯穿。

**严重性说明**：单独看每个都是 🟡，但叠加效果是"pi 包输出意外格式 → UI 静默错乱 + 调试无门"，应一起修。

---

### P1-2. SSE `JSON.parse` 失败被静默吞掉

**位置**：`hooks/useAgentSession.ts:226-228`

```ts
es.onmessage = (e) => {
  try {
    const event = JSON.parse(e.data) as AgentEvent;
    handleAgentEventRef.current?.(event);
  } catch {
    // ignore
  }
};
```

**修复**：`console.warn("[SSE] malformed event", e.data)`。dev 环境带 stack，prod 上报到 Sentry 类服务（前提是 P2-1 的可观测性建设）。

---

### P1-3. `FileViewer` 大文件无虚拟滚动

**位置**：`components/FileViewer.tsx:815-838`

**问题**：`SyntaxHighlighter` 渲染全部内容，5000+ 行文件每次 render 全量 diff/高亮。

**修复方向**：
- 行数 > 1000 时启用虚拟滚动（`@tanstack/react-virtual`）。
- 或者：只渲染可见区域 + 滚动时增量加载。
- 文件大小 > 256KB 时给"以原始文本查看"选项。

---

### P1-4. URL 状态 ↔ React 状态双向同步用 `suppressCwdBumpRef` 互相抑制

**位置**：`components/AppShell.tsx:164-184`、`components/SessionSidebar.tsx:254-259`

**问题**：典型的"打补丁式状态同步"——`Sidebar` 的 `setSelectedCwd` → `onCwdChange` effect → AppShell 的 `handleCwdChange` → `router.replace` → URL 变 → Sidebar 重新 render → `setSelectedCwd` 再次触发。中间用 `suppressCwdBumpRef` 抑制信号避免循环。任何后续改动都可能打破这个脆弱的契约。

**修复方向**：
- AppShell 作为 URL 的 **single source of truth**，用 `useSearchParams` 监听 URL 变化，push 到内部 state。
- Sidebar 只发 action（onCwdChange 回调），不读 URL。
- 删除 `suppressCwdBumpRef` 和所有 `if (suppressRef.current) return` 分支。

---

### P1-5. 端口扫描 TOCTOU 竞争

**位置**：`electron/main.ts:136-152`（推测）

**问题**：`isPortReachable(port)` 和 `reservePort(port)` 之间有竞争窗口，另一进程可能在中间抢走端口。

**修复**：直接 `net.createServer().listen(port).unref()`，成功即代表端口可用，失败换下一个。

---

### P1-6. 启动后 Next.js 进程崩溃无自动恢复

**位置**：`electron/main.ts:205-213`

**问题**：进程退出后只更新状态显示"已停止"，不重启。生产环境短暂端口冲突让用户必须手动重启整个 app。

**修复方向**：
- 引入 supervisor 状态机：`starting → ready → supervised`。`supervised` 状态下进程退出 → 自动重试（指数退避 1s/2s/4s/...），最多 3 次。
- 重试次数用完后切回 `error` 状态，弹"重试"按钮。

---

### P1-7. `electron-builder.yml` 的 extraResources 列表手工维护

**位置**：`electron-builder.yml:50-56`

**问题**：19 个 npm 包手写，漏一个就 `MODULE_NOT_FOUND`。依赖图变化后这个列表需要手动同步。

**修复方向**：
```yaml
extraResources:
  - from: .next/standalone
    to: standalone
    filter: ["**/*", "!node_modules"]
  - from: .next/standalone/node_modules
    to: standalone/node_modules
  - from: .next/static
    to: standalone/.next/static
  - from: public
    to: standalone/public
  # 不再手写 electron-updater 的传递依赖
```
让 electron-builder 自己解析。`asarUnpack` 处理需要写入的目录（logs、config）。

---

### P1-8. `electron/startup.html:133` 的 CSP 是 `script-src 'unsafe-inline'`

**位置**：`electron/startup.html:133`

**问题**：CSP 允许内联脚本，message 注入虽然用 `textContent`（安全），但纵深不足——任何后续改 `innerHTML` 的提交都会引入 XSS。

**修复**：用 `<script src="...">` 拆出内联脚本，CSP 改为 `script-src 'self'`。

---

### P1-9. SKILLS_API_URL 改 env 后可能变 SSRF

**位置**：`app/api/skills/search/route.ts:63`

**问题**：`SKILLS_API_URL` 默认是 `https://skills.sh`，但 env 变量没有校验。如果攻击者通过某种途径修改（共享电脑、CI 注入）会变成任意 URL → SSRF。

**修复方向**：
- 启动时校验 env，URL 必须在白名单（`skills.sh` / staging / 本地 mock）。
- 或在 `route.ts` 入口固定 `const ALLOWED_HOSTS = ["skills.sh", "staging.skills.sh"]`，请求前比对。

---

### P1-10. 派生值未 memo

**位置**：`hooks/useAgentSession.ts:131`（currentModel）、`hooks/useAgentSession.ts:134-149`（sessionStats）

**问题**：`currentModel` 和 `sessionStats` 每次 render 重算。`sessionStats` 遍历整个 messages 数组。

**修复**：包 `useMemo`。`currentModel` 的 deps 是 `[currentModelOverride, data?.context.model, pendingModel]`；`sessionStats` 的 deps 是 `[messages]`。

---

## 3. P2 — 锦上添花

### P2-1. 完全没有可观测性

**现状**：`console.*` 在 Electron 同步写文件但无级别；autoUpdater 有 `logError` 但其他全无。生产环境出错只能看本地文件。

**修复方向**：
- 引入轻量结构化日志（`pino`）替代 `console.*`。
- API route catch 统一 `logError(err, { route, requestId })`。
- 可选：接 Sentry 类服务（需要权衡隐私 vs 调试便利）。

---

### P2-2. fork / compact 核心逻辑零测试

**位置**：`lib/rpc-manager.ts:113-143`（fork）、`lib/rpc-manager.ts:163-181`（compact）

**修复**：
- `lib/rpc-manager.test.ts` 测 fork 成功 / 取消（cancelled）/ invalid entryId / 旧 wrapper 已销毁。
- `electron/process-tree.test.ts` 测 pid 为 null、Windows 路径、`taskkill /T` 退出码。

---

### P2-3. 工具名白名单硬编码

**位置**：`lib/rpc-manager.ts:299`

```ts
const allCodingToolNames = ["read", "bash", "edit", "write", "grep", "find", "ls"];
```

**修复**：首次启动时从 `inner.getAllTools()` 缓存到 `globalThis.__piBuiltInToolNames`，避免硬编码与 pi 包不同步。

---

### P2-4. 启动日志缺关键信息

**位置**：`electron/main.ts:100`

**修复**：`logStartupTiming` 在 dev 模式 console.log，prod 模式写文件。错误状态（`serverState === "stopped"`）的 message 应带退出码、信号量、最近 N 行 stdout/stderr。

---

### P2-5. 无 git hooks / CI

**修复**：加 `husky` + `lint-staged`（`pre-commit` 跑 `tsc --noEmit` + `eslint --fix`），GitHub Actions 跑 `npm test` + `npm run build`。

---

### P2-6. AGENTS.md 警告与脚本命名歧义

**修复**：把 `npm run build` 重命名为 `npm run build:standalone`（更明确），AGENTS.md 警告改为指向这个明确名字。

---

## 4. 测试覆盖盲区（建议修复 P0 时同步补）

| 模块 | 现状 | 建议补 |
|---|---|---|
| `lib/rpc-manager.ts` fork | 0 测试 | fork 成功 / 取消 / invalid entryId / 旧 wrapper 销毁 |
| `lib/rpc-manager.ts` compact | 0 测试 | `historyEnd <= boundaryStart` 抛错 / 正常路径 |
| `app/api/sessions/[id]/route.ts` DELETE | 0 测试 | 并发 DELETE 父 + 子 / 级联重写原子性 |
| `app/api/agent/[id]/events/route.ts` SSE | 0 测试 | heartbeat 触发 / client disconnect 清理 / `req.signal.abort` |
| `electron/process-tree.ts` | 0 测试 | Windows `taskkill /T` / pid 为 null 边界 |
| `hooks/useAgentSession.ts` SSE 重连 | 0 测试 | 1s 后重连 / `agentRunningRef` 切换时不重连 |
| `lib/normalize.ts` | 缺边界 | `toolCallId` / `id` 都缺 / 都是空串的降级 |

---

## 5. 重构优先级（如果你只有 1 周）

| 优先级 | 项 | 理由 |
|---|---|---|
| **P0 周一** | P0-1 JSONL 写锁 + P0-2 idle timer | 唯一可能导致**静默数据丢失**的两条 |
| **P0 周二** | P0-3 fork 时序契约 | 跨 RPC + SSE + UI 三层，迟早踩 |
| **P0 周三-四** | P0-5 ChatWindow 渲染 + P0-6 hooks mount effect | 影响**所有**长会话用户的体验，根因都在 hooks 层 |
| **P0 周五** | P1-1 normalize + API catch（一个 PR 拿到类型安全 + 可观测性） |  |
| **P1 同步** | 补 P0 涉及的测试（参考第 4 节） | 避免回归 |
| **P1 第二周** | P1-4 URL 状态 + P1-7 extraResources + P1-6 启动恢复 | 影响发版质量，不影响日常开发 |
| **P2 攒批** | 上面 6 条 | 见仁见智，可分配 1 PR / 1 条 |

---

## 6. 范围外 / 后续议题

- **i18n**：当前 UI 文案英文 + 部分 thinking level 描述中文（混合状态）。P2 之外。
- **Error Boundary**：组件级错误边界缺失，SSE 断连或数据异常可能导致整页崩溃。P1 范围但优先级低于上述项。
- **OAuth 流程**：`/api/auth/login/[provider]` 的 SSE 流式认证未深入审。
- **打包体积**：`build/` 目录的具体包体未实测，P1-7 改完后建议跑一次对比。

---

## 7. 评审方法

- 4 个并行 Explore agent 分别扫描：数据层 + Agent 生命周期 / UI 状态 + React 数据流 / API + Electron 集成 / 横切关注点（测试/类型/错误/可观测性）。
- 本文档对 P0 全部位置在主分支上做了 Read 复核；P1/P2 引用的是 agent 报告的行号，建议动手前用 Read 核对一次。
- 没有运行 `npm test` / `npm run build` / 启动 dev server——本评审仅静态分析。修复时建议同步跑一遍验证。
