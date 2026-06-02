# P0-6 hooks mount effect 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mount effect 在 `session?.id` 变化时重跑 + 重置全部 session-scoped state + 用闭包守卫避免 stale `.then` 覆盖新 session。

**Architecture:** `hooks/useAgentSession.ts` 单一文件改动。deps 从 `[]` 改为 `[session?.id]`；effect 入口加 early return 与 state reset 块；引入 `let cancelled = false; return () => { cancelled = true; };` 闭包守卫；保留 `eslint-disable`（useState 的 setter 引用稳定但 lint 不识别）。

**Tech Stack:** React 19、TypeScript 5 (strict)、Next.js 16、`node --test`（无 React testing infra，无新增自动化测试）。无新依赖。

**Spec:** `docs/superpowers/specs/2026-06-01-p0-6-hooks-mount-effect-design.md`

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `hooks/useAgentSession.ts` | 修改 | destructure 补 `setEntryIds` + 替换 mount effect（~30 行） |

---

## Task 1: destructure 补 `setEntryIds`

**Files:**
- Modify: `hooks/useAgentSession.ts:51-63`（`useSessionLoader` 解构块）

- [ ] **Step 1.1: 检查当前 destructure 是否含 `setEntryIds`**

Read `hooks/useAgentSession.ts` 第 51-63 行的 destructure 块。**注意：实施 P0-3 时已改过这文件，destructure 实际状态需重新读确认。**

如果当前 destructure 已含 `setEntryIds` → 跳到 Task 2。

如果不含 → 替换为：

```typescript
  const {
    data, setData, loading, error, activeLeafId, setActiveLeafId,
    messages, setMessages, entryIds, setEntryIds,
    loadSession, loadContext,
  } = useSessionLoader(isNew);
```

- [ ] **Step 1.2: tsc**

Run: `node_modules/.bin/tsc --noEmit`
Expected: 0 errors。

（如跳过本 Task 即无此步骤。）

---

## Task 2: 替换 mount effect

**Files:**
- Modify: `hooks/useAgentSession.ts` (line 428-454 mount effect 块)

- [ ] **Step 2.1: 替换 mount effect**

In `hooks/useAgentSession.ts`，找到当前 mount effect 块（行号约 428-454），**整段替换为**：

```typescript
  // Load session on mount AND on session change.
  //
  // On session change, reset all session-scoped state to avoid bleed
  // from a previous session. AppShell's sessionKey remount is kept
  // as defense-in-depth (covers state in sub-hooks like
  // useChatScroll / useAgentEvents that we can't reset from here).
  //
  // The cancelled flag is a closure guard: when session A→B, the
  // effect's cleanup runs before the next effect call. Cleanup
  // sets cancelled=true on the OLD closure; the OLD .then (still
  // in flight) sees the flag and bails. Makes the effect
  // self-sufficient even if AppShell's remount is later removed.
  useEffect(() => {
    if (!session) return;
    const sid = session.id;
    sessionIdRef.current = sid;
    let cancelled = false;

    // Reset session-scoped state. Ordered to mirror useState
    // declarations above for readability.
    setData(null);
    setActiveLeafId(null);
    setMessages([]);
    setEntryIds([]);
    setToolPreset("default");
    setThinkingLevel("auto");
    setAgentRunning(false);
    setAgentPhase(null);
    dispatch({ type: "reset" });   // streamState → {isStreaming:false, streamingMessage:null}
    setRetryInfo(null);
    setContextUsage(null);
    setSystemPrompt(null);
    setForkingEntryId(null);
    setIsCompacting(false);
    setCompactError(null);
    setCurrentModelOverride(null);
    setPendingModel(null);

    loadSession(sid, true, true).then((loaded) => {
      if (cancelled) return;  // ignore stale results from a previous session
      const agentState = loaded?.agentState ?? null;
      if (!agentState?.state?.thinkingLevel && loaded?.contextThinkingLevel && loaded.contextThinkingLevel !== "off") {
        setThinkingLevel(loaded.contextThinkingLevel as ThinkingLevelOption);
      }
      if (agentState?.running) {
        loadTools(sid);
        if (agentState.state?.isStreaming) {
          setAgentRunning(true);
          setAgentPhase({ kind: "waiting_model" });
          connectEvents(sid);
        }
      }
      if (agentState?.state) {
        if (agentState.state.isCompacting !== undefined) setIsCompacting(agentState.state.isCompacting);
        if (agentState.state.contextUsage !== undefined) setContextUsage(agentState.state.contextUsage ?? null);
        if (agentState.state.systemPrompt !== undefined) setSystemPrompt(agentState.state.systemPrompt ?? null);
        if (agentState.state.thinkingLevel !== undefined) setThinkingLevel((agentState.state.thinkingLevel as ThinkingLevelOption) ?? "auto");
      }
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);
```

变更点：
- 入口 `if (session)` → `if (!session) return;`（early return 风格）
- deps `[]` → `[session?.id]`
- 加 16 个 setter + 1 个 `dispatch({type:"reset"})` reset 块
- 加 `let cancelled = false;` 局部变量 + 闭包
- `.then` 开头加 `if (cancelled) return;` 守卫
- 加 return cleanup 闭包 `return () => { cancelled = true; };`
- 保留 `// eslint-disable-next-line react-hooks/exhaustive-deps`（useState 的 setter 引用稳定但 lint 不识别）
- 注释解释 why cancelled 守卫 + 为什么保留 eslint-disable

- [ ] **Step 2.2: tsc + lint**

Run: `node_modules/.bin/tsc --noEmit`
Expected: 0 errors。

Run: `node_modules/.bin/eslint .`
Expected: 0 errors（pre-existing `MessageView.tsx` warning 仍在但与本 PR 无关；不应有新 warning——`cancelled`、`agentState`、`loaded` 等局部变量都已使用，destructure 补的 `setEntryIds` 也被使用）。

如果 lint 报 `cancelled` 或 `agentState` 之类的 unused——检查代码是否完全按上面粘贴。

- [ ] **Step 2.3: 全量测试套件**

Run: `node --test lib/*.test.ts electron/*.test.ts 'app/**/*.test.ts'`
Expected: 37/37 pass。

Run: `node --test hooks/agent-session/*.test.ts`
Expected: 10/10 pass（main 新增的 10 个测试）。

总计 47/47 pass。**0 regression**。

- [ ] **Step 2.4: 提交**

```bash
git add hooks/useAgentSession.ts
git commit -m "fix(useAgentSession): mount effect re-runs on session change with state reset

The mount effect had empty deps and an eslint-disable comment, relying
on AppShell's sessionKey remount to reset state on session change.
That remount is fragile and implicit.

Make the effect self-sufficient:
- deps: [] → [session?.id]
- Reset 16 session-scoped state setters before loadSession
- dispatch({type:'reset'}) for streamState
- 'cancelled' closure guard prevents stale .then from overwriting
  new session's state if loadSession is in flight when session changes
- destructure useSessionLoader now exposes setEntryIds (was missing)

AppShell's sessionKey remount is kept as defense-in-depth — it
covers internal refs in useChatScroll / useAgentEvents that
cannot be reset from useAgentSession.

eslint-disable is kept: useState setters are reference-stable but
exhaustive-deps doesn't recognize them as such."
```

---

## Task 3: Code review + push

- [ ] **Step 3.1: 派 code reviewer**

按 `superpowers:requesting-code-review` skill 派 general-purpose subagent 审查 P0-6 的 1 个 commit（`hooks/useAgentSession.ts`）。

- [ ] **Step 3.2: 应用 review 修复（如有）**

按 review 反馈修复 Critical / Important 问题。Minor 留给后续。

- [ ] **Step 3.3: 重新跑测试（如有修改）**

如 Step 3.2 改了代码，重跑全量测试套件确认无回归。

- [ ] **Step 3.4: Push 到远端**

```bash
git push origin analysis/architecture-optimization-review
```

- [ ] **Step 3.5: 写 PR 描述草稿（手动验证清单）**

P0-6 手动验证 4 条（切会话看无 bleed、并发切不抢 state、切完能正常发消息、tsc-lint）。

---

## Self-Review

**1. Spec 覆盖**：
- destructure 补 `setEntryIds` → Task 1 ✓
- deps `[]` → `[session?.id]` → Task 2 step 2.1 ✓
- 16 setters + dispatch reset → Task 2 step 2.1 ✓
- `cancelled` 闭包守卫 → Task 2 step 2.1 ✓
- 保留 `eslint-disable` + 注释 → Task 2 step 2.1 ✓
- 早返回 `if (!session) return;` → Task 2 step 2.1 ✓
- 注释解释 why → Task 2 step 2.1 ✓
- 错误处理（与现有行为一致）✓
- 测试策略（47 测试通过、手动验证 4 条）→ Task 2 step 2.3 + Task 3 ✓
- 验证清单 → Task 2 step 2.2-2.3 ✓
- 实施顺序（destructure → effect → verify → push）→ 3 tasks 顺序一致 ✓
- PR 范围（1 文件、~30 行、1 commit）→ 实际 1 commit ✓

**2. 占位符扫描**：无 TBD/TODO；所有代码块完整。

**3. 类型一致性**：
- `setEntryIds` 在 destructure 引入、在 reset 块使用、签名 `(value: string[]) => void` ✓
- `dispatch({ type: "reset" })` 与 `streamReducer` 的 `case "reset"` 已支持 ✓
- `connectEvents(sid)` 与 `useAgentEvents` 暴露签名一致 ✓
- `loadSession(sid, showLoading, includeState)` 与 `useSessionLoader.loadSession` 一致 ✓

无 inline 修正。
