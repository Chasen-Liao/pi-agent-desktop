# P0-6 hooks mount effect + eslint-disable 设计

> 分支：`analysis/architecture-optimization-review` · 日期：2026-06-02 · 关联评审：`docs/architecture-review-2026-06-01.md` §1 P0-6

## 背景

`hooks/useAgentSession.ts:429-454` 的 mount effect 用了空 deps `[]` 和 `// eslint-disable-next-line react-hooks/exhaustive-deps`。当 `session` prop 从 A→B 变化时（组件未卸载）：

- effect 不会重跑（旧 deps 是 `[]`）
- A 的 SSE 连接不会被关闭（`cleanup` 只在 unmount 触发）
- 新 `connectEvents(session.id)` 在 EventSource 已存在时不会自动重连——它只在 `eventSourceRef.current` 不为 null 时 close 旧的再开新的。但 effect 没重跑，所以新的 `connectEvents` 调用没发生

AppShell 靠 `<ChatWindow key={sessionKey}>` 强制 remount 来掩盖这个 bug——session 切换时整个 `useAgentSession` 实例被销毁重建。这是**隐性契约**，未来加新 prop 必然踩坑。

详见评审 doc P0-6 条目。

## 目标

- `session` prop 变化时（不 remount）mount effect 重跑
- 旧的 SSE 在 effect 重跑时关闭
- **不会**有 A 状态渗到 B 的"bleed"问题（包括消息、tree、agentRunning 等所有 session-scoped state）
- 不会引入新 bug

## 非目标

- 不抽 `useSessionInit` hook（架构评审 §1 P0-6 推荐方案 A）
- 不重构 `useSessionLoader.ts`（c1d68cd 已抽好）
- 不动 `useAgentEvents` / `useChatScroll` 的内部 ref（那些 ref 没法从外部 reset）
- **不**移除 AppShell 的 `sessionKey` remount（保留为 defense-in-depth，覆盖 `useChatScroll` 等子 hook 内部 state）
- 不重构 `useSessionLoader.loadSession` 的 fetch 行为（不引入 `AbortController`——本次 effect 自带 `cancelled` 守卫足够）

## 方案概览

1 个文件 `hooks/useAgentSession.ts` 修改：

- destructure 块加 `setEntryIds`（之前漏 destructure）
- mount effect：
  - deps 从 `[]` 改为 `[session?.id]`
  - 加 `if (!session) return;` 早返回
  - 加 16 个 setter 调用 + 1 个 `dispatch({type:"reset"})`，重置 session-scoped state
  - 加 `let cancelled = false; return () => { cancelled = true; };` 守卫 stale `.then`
  - 保留 `// eslint-disable-next-line react-hooks/exhaustive-deps`（useState 的 setter 引用稳定，但 `exhaustive-deps` lint 不识别）

## `hooks/useAgentSession.ts` 的 destructure 块

确认 line 51-63 的 `useSessionLoader` 解构包含 `setEntryIds`（这是用来在重置时清空 entryIds 的）。如果当前解构里没有 `setEntryIds`，把它补上：

```typescript
  const {
    data, setData, loading, error, activeLeafId, setActiveLeafId,
    messages, setMessages, entryIds, setEntryIds,
    loadSession, loadContext,
  } = useSessionLoader(isNew);
```

## `hooks/useAgentSession.ts` 的 mount effect

替换前（line 429-454）：
```typescript
  // Load session on mount
  useEffect(() => {
    if (session) {
      sessionIdRef.current = session.id;
      loadSession(session.id, true, true).then((loaded) => {
        const agentState = loaded?.agentState ?? null;
        if (!agentState?.state?.thinkingLevel && loaded?.contextThinkingLevel && loaded.contextThinkingLevel !== "off") {
          setThinkingLevel(loaded.contextThinkingLevel as ThinkingLevelOption);
        }
        if (agentState?.running) {
          loadTools(session.id);
          if (agentState.state?.isStreaming) {
            setAgentRunning(true);
            setAgentPhase({ kind: "waiting_model" });
            connectEvents(session.id);
          }
        }
        if (agentState?.state) {
          if (agentState.state.isCompacting !== undefined) setIsCompacting(agentState.state.isCompacting);
          if (agentState.state.contextUsage !== undefined) setContextUsage(agentState.state.contextUsage ?? null);
          if (agentState.state.systemPrompt !== undefined) setSystemPrompt(agentState.state.systemPrompt ?? null);
          if (agentState.state.thinkingLevel !== undefined) setThinkingLevel((agentState.state.thinkingLevel as ThinkingLevelOption) ?? "auto");
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

替换为：
```typescript
  // Load session on mount AND on session change.
  //
  // On session change, reset all session-scoped state to avoid bleed
  // from a previous session. AppShell's sessionKey remount is kept
  // as defense-in-depth (it covers state in sub-hooks like
  // useChatScroll / useAgentEvents that we can't reset from here).
  //
  // The cancelled flag is a closure guard: when session A→B, the
  // effect's cleanup runs before the next effect call. Cleanup
  // sets cancelled=true on the OLD closure; the OLD .then (still
  // in flight) sees the flag and bails. This makes the effect
  // self-sufficient even if AppShell's remount is later removed.
  useEffect(() => {
    if (!session) return;
    const sid = session.id;
    sessionIdRef.current = sid;
    let cancelled = false;

    // Reset session-scoped state. Ordered to mirror the useState
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

## 数据流

```
session A → session B
  │
  ├─ AppShell bumps sessionKey → ChatWindow REMOUNTS
  │    (新 useAgentSession 实例，初始空 state；本文 doc 不改这个)
  │
  └─ [防御性冗余 / 未来如果移除 remount] effect 重跑：
       │
       ├─ 旧 effect cleanup：cancelled = true（旧闭包）
       ├─ 新 effect body：
       │    ├─ 15 个 setter 重置 session-scoped state
       │    ├─ loadSession(B, ..., true) → fetch
       │    └─ .then 闭包（含 cancelled 检查）
       │
       ├─ Race 1: A 的 loadSession.fetch 还在飞
       │    └─ A 的 .then 触发 cancelled 检查 → 旧闭包 cancelled=true → 早返回
       │       （A 的 state setter 在 unmounted 实例上是 no-op）
       │
       └─ B 的 .then 触发 cancelled 检查 → 新闭包 cancelled=false → 应用 B 的 state
```

## 错误处理

- `loadSession` 抛错：`.then` 没有 `.catch`，未处理错误会被 React 捕获并 console.error。**与现有行为一致**，本次不修
- `connectEvents` 抛错：同样无 `.catch`，现有行为
- `cancelled` 检查在 `.then` 开头：如果 A 的 `.then` 在 cancelled 设了 true 之后才被调度到执行，cancelled 检查能拦住

## 测试策略

**不写自动化测试**（项目无 React testing infra）。`node --test` 不支持 mount React 组件。

### 手动验证清单（写进 PR description）

- [ ] 启动 dev，浏览器创建 A 会话，发消息让它 running（agent 正在回复）
- [ ] 切到 B 会话。观察：B 的消息列表立即是空的（不是 A 的 50 条），tree/leafId 重置，无 agentRunning 闪 A 的状态，无旧 SSE
- [ ] 并发切：快速点 A→B→A（300ms 内），观察最后 A 的 state 正确（无 race 让 A 的 .then 覆盖 B 或反之）
- [ ] 切完会话能正常发消息（agent 仍能接 prompt）

### 自动化测试

跑全量测试套件确认无回归：
- `node --test lib/*.test.ts electron/*.test.ts 'app/**/*.test.ts'`
- 跑 `node --test hooks/agent-session/*.test.ts`（10 个 main 新增测试）

## 范围外（本次 P0-6 不做）

- 抽 `useSessionInit` hook（评审 §1 P0-6 推荐方案 A 是"deps + reset"，不是抽 hook）
- 重构 `useSessionLoader.loadSession` 加 `AbortController`
- 移除 AppShell 的 `sessionKey` remount
- 修改 `useChatScroll` / `useAgentEvents` 内部 ref 暴露
- 重构 `useAgentSession.ts` 其他 effect

## 风险

| 风险 | 缓解 |
|---|---|
| `cancelled` 守卫对 `.then` 之外的失败路径无效 | A 的 useEffect 已被 cleanup（返回的函数），setter 在 unmounted 实例上是 no-op |
| `useSessionLoader` 内部的 `loading` / `error` state 没 reset | 接受 ~100ms 闪烁（`loadSession` 立即设 `loading=true`、成功后清 error） |
| `setToolPreset` 依赖 `toolPreset` 父 prop（来自 useState 还是父）| 检查依赖链；若 `toolPreset` 来自 useState（line 71），用 `setToolPreset` |
| 保留 `eslint-disable` 是债务 | 加注释解释为什么；将来若换用 `useEffectEvent` 或 React 19 新 API，可消除 |
| AppShell 移除 remount → bleed 回到 | 本次设计确保 self-sufficient；remount 移除是独立 PR |

## 验证清单

- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run lint` 通过
- [ ] 全量测试套件（37 已有 + 10 main 新增 = 47）通过
- [ ] 手动验证 4 条通过

## 实施顺序

1. 确认 `setEntryIds` 是否在 destructure 块里；若不在，添加
2. 替换 mount effect（按上述代码块）
3. tsc + lint + 全量测试
4. commit

## PR 范围

- 1 文件修改（`hooks/useAgentSession.ts`）
- ~30 行变动
- 一个 commit，一个 PR
