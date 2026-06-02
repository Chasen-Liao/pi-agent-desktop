# P0-3 fork / navigate_tree 状态时序契约设计

> 分支：`analysis/architecture-optimization-review` · 日期：2026-06-01 · 关联评审：`docs/architecture-review-2026-06-01.md` §1 P0-3

## 背景

`AgentSessionWrapper.send({type:"fork"})` 末尾 `this.destroy()` 立即触发 `onDestroyCallback → registry.delete(realSessionId)`，但 fork 产生的新 session id 此时还没在注册表里——要等 UI 收到响应、切换会话后由 `POST /api/agent/[newId]` 触发 `startRpcSession` 才注册。窗口期内对 newId 的请求会走"重新创建"路径，依赖隐式行为。

`useAgentSession.handleNavigate` / `handleLeafChange` 把 `navigate_tree` 当 fire-and-forget（`.catch(() => {})`），UI 在 agent 响应前就 `setActiveLeafId(entryId)` + `loadContext(sid, entryId)`。如果 pi 的 `navigateTree` 返回 `{cancelled: true}`，UI 已显示新 leaf 但 agent 仍停留在旧 leaf，用户接下来发的消息会基于错误的"对话分支"。

详见评审 doc P0-3 条目。

## 目标

- **fork**：返回时新 session id 已在注册表里，UI 切换后能直接命中
- **navigate**：agent 拒绝时 UI 不更新，用户不看到"假"的 leaf
- 不引入通用 `command_ack` 协议（over-engineering for 2 个命令）
- 不引入新 npm 依赖

## 非目标

- 不改 fork 的文件 IO 路径（`SessionManager.create` / `createBranchedSession` / `cacheSessionPath` 内部逻辑）
- 不改 POST `/api/agent/[id]` route handler
- 不修 fork 失败时的部分回滚（接受新文件残留磁盘——下次 fork 可被覆盖）
- 不引入 `command_ack` 通用协议
- 不修 fork 核心逻辑的测试覆盖（评审 §4 列了但属独立工作，需要 mock `pi` 内部 API 是集成测试范畴）
- 不引入 React testing infra（`useAgentSession` hook 的测试覆盖现状无法在 `node --test` 体系下做）

## 方案概览

两个改动，跨服务端/客户端：

| 文件 | 改动 | 性质 |
|---|---|---|
| `lib/rpc-manager.ts` | `case "fork"` 增加 `startRpcSession` 预注册 | 服务端：建立契约 |
| `hooks/useAgentSession.ts` | 抽 `navigateToLeaf` helper，await + check `cancelled` | 客户端：遵守契约 |

## `lib/rpc-manager.ts` 的 fork case

在现有 fork 实现末尾的 `this.destroy()` 之前插入预注册：

```typescript
case "fork": {
  const entryId = command.entryId as string;
  const sessionManager = this.inner.sessionManager;
  const currentSessionFile = this.inner.sessionFile;

  if (!sessionManager.isPersisted()) return { cancelled: true };
  if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

  const entry = sessionManager.getEntry(entryId);
  if (!entry) throw new Error("Invalid entry ID for forking");

  const sessionDir = sessionManager.getSessionDir();
  let newSessionFile: string;

  if (!entry.parentId) {
    const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
    newManager.newSession({ parentSession: currentSessionFile });
    newSessionFile = newManager.getSessionFile() as string;
  } else {
    const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
    const forkedPath = sourceManager.createBranchedSession(entry.parentId);
    if (!forkedPath) throw new Error("Failed to create forked session");
    newSessionFile = forkedPath;
  }

  const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
  cacheSessionPath(newSessionId, newSessionFile);

  // Pre-register the new wrapper BEFORE destroying the old.
  // Contract: by the time send() returns, newSessionId is in the registry.
  // If startRpcSession throws, do NOT destroy — old wrapper stays usable,
  // new file remains on disk (acceptable; next fork overwrites).
  const newCwd = sessionManager.getHeader()?.cwd ?? process.cwd();
  await startRpcSession(newSessionId, newSessionFile, newCwd);

  this.destroy();
  return { cancelled: false, newSessionId };
}
```

变更点：
- `cacheSessionPath` 之后、`this.destroy()` 之前，加 `startRpcSession` 预注册
- `startRpcSession` 已在 `globalThis.__piStartLocks` 加锁，并发安全由锁保证

## `hooks/useAgentSession.ts` 的 navigate

抽出共享 helper，`handleNavigate` 和 `handleLeafChange` 都走它：

```typescript
const navigateToLeaf = useCallback(async (leafId: string | null) => {
  if (!leafId) {
    setActiveLeafId(null);
    return;
  }
  const sid = sessionIdRef.current;
  if (!sid) return;
  try {
    const result = await sendAgentCommand<{ cancelled?: boolean }>(sid, {
      type: "navigate_tree",
      targetId: leafId,
    });
    if (result?.cancelled) {
      console.warn("navigate_tree cancelled:", leafId);
      return;  // UI 不更新，BranchNavigator 视觉仍指向旧 leaf
    }
    setActiveLeafId(leafId);
    await loadContext(sid, leafId);
  } catch (e) {
    console.error("navigate_tree failed:", e);
  }
}, [loadContext]);

const handleNavigate = useCallback((entryId: string) => {
  return navigateToLeaf(entryId);
}, [navigateToLeaf]);

const handleLeafChange = useCallback((leafId: string | null) => {
  return navigateToLeaf(leafId);
}, [navigateToLeaf]);
```

变更点：
- `navigateToLeaf` 新增：`sendAgentCommand` 从 fire-and-forget 改为 `await`，并检查 `result.cancelled`
- `setActiveLeafId` 和 `loadContext` 移到 `navigate_tree` 成功之后
- 旧 `handleNavigate` / `handleLeafChange` 各自 inline 的 5-6 行实现替换为对 `navigateToLeaf` 的转发，签名不变（`useChatWindow` 的调用方无感）

## 数据流

### fork（轻量"先注册再销毁"变体）

```
UI: handleFork(entryId)
  │
  └─ POST /api/agent/[sid] { type: "fork", entryId }
       │
       └─ wrapper.send({type:"fork", entryId})  // 旧 wrapper
            │
            ├─ SessionManager.create/open + createBranchedSession
            ├─ cacheSessionPath(newId, newFile)
            ├─ ★ await startRpcSession(newId, newFile, cwd)  // 新 wrapper 在册
            └─ this.destroy()                                 // 旧 wrapper 出册
       
       └─ return { cancelled: false, newId }
  
  └─ onSessionForked(newId)  // UI 切到新 session
       │
       └─ 新 chat mount: connectEvents(newId)  // SSE 路由 getRpcSession(newId) 命中
```

注册表状态时序：
```
[oldId: oldWrapper, newId: ∅]   ← 初始
[oldId: oldWrapper, newId: ∅]   ← cacheSessionPath 后
[oldId: oldWrapper, newId: newWrapper]   ← startRpcSession 后
[oldId: ∅,        newId: newWrapper]   ← destroy 后
```

### navigate

```
UI: BranchNavigator click → onLeafChange(leafId)
  │
  └─ navigateToLeaf(leafId)
       │
       ├─ sendAgentCommand POST navigate_tree
       │     │
       │     └─ wrapper.send({type:"navigate_tree", targetId})
       │          └─ inner.navigateTree(targetId, {})
       │
       ├─ if cancelled → console.warn, return（UI 不变）
       └─ if not cancelled
            ├─ setActiveLeafId(leafId)
            └─ loadContext(sid, leafId)
```

## 错误处理

| 场景 | 行为 | 客户端可见 |
|---|---|---|
| `startRpcSession` 预注册失败（pi 初始化抛错） | fork case 抛异常 → **不调** `this.destroy()` → 旧 wrapper 仍在册，新文件残留磁盘 | 500 + 旧 session 仍可用 |
| `sendAgentCommand` 抛错（network / 500） | `navigateToLeaf` catch + log | UI 不变（无 toast） |
| `navigate_tree` 返回 `{cancelled: true}` | `console.warn`，return | UI 不变（BranchNavigator 视觉仍指旧 leaf） |
| 同一 sessionId 并发 fork | `startRpcSession` 锁串行化；第二次进 fork case 时旧 wrapper 已被第一次 destroy | 第二次 fork 走 500（不可达，但 safe） |

## 测试策略

### `lib/rpc-manager.test.ts`：加 1 个测试

```typescript
test("fork returns {cancelled: true} for non-persisted session", () => {
  const inner = makeStubInner({
    sessionManager: { isPersisted: () => false },
    sessionFile: "stub.jsonl",
  });
  const w = new AgentSessionWrapper(inner);
  w.start();
  return w.send({ type: "fork", entryId: "x" }).then((result) => {
    assert.deepEqual(result, { cancelled: true });
  });
});
```

这是评审 §4 列入的测试盲区（已有逻辑，无新加）。补这个测试不动新行为，只锁住既有契约。

### 不测的部分

- **fork 完整成功路径**：需要 mock `pi` 的 `SessionManager.open` / `createBranchedSession` / `cacheSessionPath` —— 集成测试范畴，本 PR 不做。
- **navigate `useAgentSession` hook**：React hook 测试需要 React Testing Library + jsdom，项目用 `node --test` 没有这套基建。留给未来。

### 手动验证清单（写进 PR description）

- [ ] 启动 dev，浏览器创建会话、发送消息，fork 出子会话；UI 立即切换到子会话；DevTools Network 面板观察子会话的 SSE / loadSession / connectEvents 都正常返回（无 404 / "Session not found"）
- [ ] 在 BranchNavigator 上点击当前 leaf 的不同分支；观察 UI 平滑切换；新 leaf 的消息历史正确显示
- [ ] （如果能构造）尝试 navigate 到一个 pi 会拒绝的 entryId（例如已经在当前 leaf 的位置），观察 BranchNavigator 不切换、UI 不更新、console 出现 `navigate_tree cancelled: ...`

## 范围外（本次 P0-3 不做）

- `command_ack` 通用协议
- fork 完整成功路径的自动化测试
- React hook 测试基建
- fork 失败时清理新文件（接受残留）
- 同一 session 并发 fork 的处理（不实际可达）

## 风险

| 风险 | 缓解 |
|---|---|
| `startRpcSession` 预注册时 `createAgentSession` 抛错（旧 wrapper 销毁失败） | 抛错时**不**调 `this.destroy()`，旧 wrapper 保留；新文件残留磁盘可被下次 fork 覆盖 |
| 预注册引入 ~100ms 延迟（pi 初始化） | fork 本来就是慢操作，~100ms 可忽略；UI 等待本来就有 |
| 并发 fork 同一 session | `startRpcSession` 锁串行化；第二次进入时第一次的 destroy 已完成，第二次走 500 |
| `navigateToLeaf` 增加 await 引入 ~50ms UI 延迟 | 用户点 BranchNavigator 后到 UI 切换本就 ~100ms（loadContext 也要 await），增量延迟不可感 |
| `navigateToLeaf` 的 console.warn 在生产环境暴露 | 项目其他 handler 也是 `console.warn/error`（无 toast 基建），与项目风格一致 |

## 验证清单

- [ ] `node --test lib/*.test.ts electron/*.test.ts 'app/**/*.test.ts'` 通过
- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run lint` 通过
- [ ] 手动验证 3 条通过

## 实施顺序

1. `lib/rpc-manager.ts` fork case 插入 `startRpcSession` 预注册（~5 行）
2. `lib/rpc-manager.test.ts` 加 1 个 fork cancelled 测试
3. 跑 rpc-manager 测试 → pass
4. `hooks/useAgentSession.ts` 抽 `navigateToLeaf`、改 `handleNavigate` / `handleLeafChange`
5. tsc + lint + 全量测试
6. commit

## PR 范围

- 2 文件修改（`lib/rpc-manager.ts`、`hooks/useAgentSession.ts`）
- 1 文件修改（`lib/rpc-manager.test.ts` 加 1 个 fork cancelled 测试）
- 总计 ~35 行变动（~5 行 rpc-manager + ~15 行 useAgentSession 抽 helper + ~15 行测试）
- 一个 commit，一个 PR
