# P0-3 fork / navigate_tree 状态时序契约 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fork 返回时新 session id 已在注册表里；navigate_tree 被 agent 拒绝时 UI 不更新。

**Architecture:** fork case 改为先 `startRpcSession` 预注册再 `this.destroy()`；`useAgentSession` 抽出 `navigateToLeaf` helper，await `sendAgentCommand` 并检查 `cancelled` 标志。

**Tech Stack:** Node 20+、TypeScript 5 (strict)、React 19、`node --test` + `mock.timers`。无新依赖。

**Spec:** `docs/superpowers/specs/2026-06-01-p0-3-fork-navigate-timing-design.md`

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `lib/rpc-manager.ts` | 修改 | fork case 插入 `startRpcSession` 预注册 |
| `lib/rpc-manager.test.ts` | 修改 | 加 1 个 fork cancelled 回归测试 + 扩 `makeStubInner` 支持 `sessionManager` override |
| `hooks/useAgentSession.ts` | 修改 | 抽 `navigateToLeaf` helper；`handleNavigate` / `handleLeafChange` 改用它 |

---

## Task 1: fork cancelled 回归测试

> 评审 §4 把 "fork 无测试" 列入测试盲区。现有 fork 逻辑（`!isPersisted → cancelled: true`）没有自动化测试。本任务加 1 个测试锁住这个已有契约。注意：这是已有逻辑的测试，不是新功能的 TDD —— 写完会直接 pass。

**Files:**
- Modify: `lib/rpc-manager.test.ts`

- [ ] **Step 1.1: 扩 `makeStubInner` 支持 `sessionManager` override**

In `lib/rpc-manager.test.ts`，替换 `makeStubInner` 函数：

替换前：
```typescript
function makeStubInner(overrides: { subscribe?: SubscribeFn } = {}) {
  return {
    sessionId: "stub",
    sessionFile: "stub.jsonl",
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: false,
    autoRetryEnabled: false,
    model: null,
    getContextUsage: () => null,
    agent: { state: { systemPrompt: "", thinkingLevel: "off" } },
    sessionManager: null,
    modelRegistry: null,
    subscribe: overrides.subscribe ?? ((cb: (event: unknown) => void) => { void cb; return () => {}; }),
  } as never;
}
```

替换为：
```typescript
function makeStubInner(overrides: {
  subscribe?: SubscribeFn;
  sessionManager?: unknown;
} = {}) {
  return {
    sessionId: "stub",
    sessionFile: "stub.jsonl",
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: false,
    autoRetryEnabled: false,
    model: null,
    getContextUsage: () => null,
    agent: { state: { systemPrompt: "", thinkingLevel: "off" } },
    sessionManager: overrides.sessionManager ?? null,
    modelRegistry: null,
    subscribe: overrides.subscribe ?? ((cb: (event: unknown) => void) => { void cb; return () => {}; }),
  } as never;
}
```

变更：`sessionManager: null` 改为 `overrides.sessionManager ?? null`，新增 `sessionManager` 字段到 `overrides` 类型。

- [ ] **Step 1.2: 加 fork cancelled 测试**

In `lib/rpc-manager.test.ts`，在最后一个 test（`keepAlive is a no-op on a destroyed wrapper`）之后追加：

```typescript
test("fork returns {cancelled: true} for non-persisted session", async () => {
  const inner = makeStubInner({
    sessionManager: { isPersisted: () => false },
  });
  const w = new AgentSessionWrapper(inner);
  w.start();
  const result = await w.send({ type: "fork", entryId: "x" });
  assert.deepEqual(result, { cancelled: true });
});
```

- [ ] **Step 1.3: 跑测试，验证通过**

Run: `node --test lib/rpc-manager.test.ts`
Expected: 5/5 pass（原 4 + 新增 1）。

- [ ] **Step 1.4: 提交**

```bash
git add lib/rpc-manager.test.ts
git commit -m "test(rpc-manager): cover fork returns {cancelled:true} for non-persisted session"
```

---

## Task 2: fork case 加预注册

> fork 命令末尾不再直接 `this.destroy()`，先 `await startRpcSession(newSessionId, newSessionFile, newCwd)` 把新 wrapper 注册进 registry，再 destroy 旧 wrapper。

**Files:**
- Modify: `lib/rpc-manager.ts` (case "fork" 块, lines 113-143)

- [ ] **Step 2.1: 在 fork case 插入 `startRpcSession` 预注册**

In `lib/rpc-manager.ts`，找到 `case "fork":` 块（line 113-143），替换整个块：

替换前（line 113-143）：
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
          // Fork before the first message: create an empty session linked to this one
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }

        const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);
        this.destroy();
        return { cancelled: false, newSessionId };
      }
```

替换为：
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
          // Fork before the first message: create an empty session linked to this one
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
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

变更点（4 行新代码 + 2 行注释）：
- 在 `cacheSessionPath(newSessionId, newSessionFile);` 之后、`this.destroy();` 之前插入 `newCwd` + `await startRpcSession(...)` 两行
- 注释解释契约和失败时的行为

- [ ] **Step 2.2: 类型检查 + lint**

Run: `node_modules/.bin/tsc --noEmit`
Expected: 通过，无错误。

Run: `node_modules/.bin/eslint .`
Expected: 通过，无错误（已有的 1 个 `MessageView.tsx` warning 不算新错）。

- [ ] **Step 2.3: 跑 rpc-manager 测试 + 全量测试，确认没回归**

Run: `node --test lib/rpc-manager.test.ts`
Expected: 5/5 pass（确认 fork cancelled 测试仍 pass，行为未变）。

Run: `node --test lib/*.test.ts electron/*.test.ts 'app/**/*.test.ts'`
Expected: 36/36 pass（之前总数 + 0，因为我们改的是 src 文件，test 数不变）。

- [ ] **Step 2.4: 提交**

```bash
git add lib/rpc-manager.ts
git commit -m "fix(rpc-manager): pre-register new wrapper before destroying old in fork

By the time the fork send() returns, the new session id is in the
registry. Window where requests to the new id would re-create the
wrapper (with implicit dependencies on pi SDK behavior) is closed.

If startRpcSession throws, do NOT destroy — old wrapper stays
usable; new file remains on disk (acceptable; next fork overwrites)."
```

---

## Task 3: `useAgentSession` 抽 `navigateToLeaf` helper

> 把 `handleNavigate` / `handleLeafChange` 里的 fire-and-forget 改为 await + check `cancelled` 的显式契约。抽 `navigateToLeaf` 共享逻辑。

**Files:**
- Modify: `hooks/useAgentSession.ts` (line 411-447, `handleNavigate` 和 `handleLeafChange`)

- [ ] **Step 3.1: 替换 `handleNavigate` 和 `handleLeafChange`**

In `hooks/useAgentSession.ts`，找到 line 431-447 的 `handleNavigate` 和 `handleLeafChange`：

替换前（line 431-447）：
```typescript
  const handleNavigate = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    sendAgentCommand(sid, { type: "navigate_tree", targetId: entryId }).catch(() => {});
    setActiveLeafId(entryId);
    await loadContext(sid, entryId);
  }, [loadContext]);

  const handleLeafChange = useCallback(async (leafId: string | null) => {
    setActiveLeafId(leafId);
    const sid = sessionIdRef.current;
    if (!sid) return;
    await loadContext(sid, leafId);
    if (leafId) {
      sendAgentCommand(sid, { type: "navigate_tree", targetId: leafId }).catch(() => {});
    }
  }, [loadContext]);
```

替换为：
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
        return;
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
- 新增 `navigateToLeaf`：await `sendAgentCommand`，检查 `result.cancelled`，取消时仅 `console.warn` 不更新 UI
- `handleNavigate` / `handleLeafChange` 改为对 `navigateToLeaf` 的薄转发，签名不变（`useChatWindow` 调用方无感）
- 旧的 fire-and-forget `.catch(() => {})` 改为 try/catch + `console.error`

- [ ] **Step 3.2: 类型检查 + lint**

Run: `node_modules/.bin/tsc --noEmit`
Expected: 通过，无错误。

Run: `node_modules/.bin/eslint .`
Expected: 通过，无错误。

- [ ] **Step 3.3: 提交**

```bash
git add hooks/useAgentSession.ts
git commit -m "fix(useAgentSession): await navigate_tree and respect cancelled flag

Old code: fire-and-forget, setActiveLeafId fires before agent
acknowledges, BranchNavigator UI can show a leaf the agent
rejected. New code: await the command, check {cancelled:true},
leave UI unchanged on rejection."
```

---

## Task 4: 验证

- [ ] **Step 4.1: 跑全量测试套件**

Run: `node --test lib/*.test.ts electron/*.test.ts 'app/**/*.test.ts'`
Expected: 36/36 pass（之前 35 + 1 个 fork cancelled 测试）。

- [ ] **Step 4.2: 类型检查 + lint**

Run: `node_modules/.bin/tsc --noEmit && node_modules/.bin/eslint .`
Expected: 通过。

- [ ] **Step 4.3: 手动验证清单（写进 PR description）**

- [ ] 启动 dev，浏览器创建会话、发送消息、fork 出子会话；UI 立即切换；DevTools Network 面板观察子会话的 SSE / loadSession / connectEvents 都正常返回（无 404 / "Session not found"）
- [ ] 在 BranchNavigator 上点击当前 leaf 的不同分支；UI 平滑切换；新 leaf 的消息历史正确显示
- [ ] （如果能构造）尝试 navigate 到一个 pi 会拒绝的 entryId；BranchNavigator 不切换、UI 不更新、console 出现 `navigate_tree cancelled: ...`

---

## Self-Review

**1. Spec 覆盖**：
- fork 预注册 → Task 2 step 2.1 ✓
- `navigateToLeaf` helper + cancelled 检查 → Task 3 step 3.1 ✓
- `startRpcSession` 抛错时 **不** destroy 旧 wrapper → Task 2 step 2.1 注释 + Task 2 step 2.3 跑测试覆盖 ✓
- `console.warn` 静默取消 → Task 3 step 3.1 ✓
- 错误处理表（fork 预注册失败、network error、cancelled）→ Task 2/3 ✓
- 测试策略（1 个 fork cancelled 测试）→ Task 1 ✓
- 不测 fork 完整成功路径 / 不测 navigate（hook）→ Task 4 step 4.3 手动清单 + spec 解释 ✓
- 手动验证 3 条 → Task 4 step 4.3 ✓
- 验证清单（test/tsc/lint）→ Task 4 steps 4.1-4.2 ✓
- 实施顺序（test 1 → fork 2 → navigate 3 → verify 4）→ 4 tasks 顺序匹配 ✓

**2. 占位符扫描**：无 TBD/TODO/未定义引用；所有代码块完整。

**3. 类型一致性**：
- `makeStubInner` 新签名 `{ subscribe?, sessionManager? }` 在 Task 1 step 1.1 定义，Task 1 step 1.2 调用 — 一致 ✓
- `navigateToLeaf(leafId: string | null)` 签名在 Task 3 step 3.1 定义，调用方 `handleNavigate` / `handleLeafChange` 转发 — 一致 ✓
- `startRpcSession(newSessionId, newSessionFile, newCwd)` 三参调用与 `lib/rpc-manager.ts` 现有签名一致 ✓
- `sendAgentCommand<{ cancelled?: boolean }>(...)` 类型断言 — 与 `agent-client.ts` 现有泛型一致 ✓

无 inline 修正。
