# P0-2 idle timer 与 SSE heartbeat 解耦设计

> 分支：`analysis/architecture-optimization-review` · 日期：2026-06-01 · 关联评审：`docs/architecture-review-2026-06-01.md` §1 P0-2

## 背景

`lib/rpc-manager.ts:50-53` 的 idle timer 只在 pi `subscribe` 回调收到事件时重置。`app/api/agent/[id]/events/route.ts:44-50` 的 SSE heartbeat 每 30s 发 `:\n\n` comment，不通过 `subscribe`，因此不重置 timer。当 agent 等 LLM 响应超过 10 分钟（Opus thinking、长时间工具执行）→ timer 到期 → wrapper 销毁 → SSE 断流 → 用户看到"连接已断开"。详见评审 doc P0-2 条目。

## 目标

- 长任务（> 10 分钟）下 SSE 仍能保持 wrapper 存活
- 客户端真实断开时 wrapper 仍能被 idle timer 正常回收（无内存泄漏）
- 不引入新 npm 依赖
- 不重构 `AgentSessionWrapper`

## 非目标

- 不把 timer 从 10 min 改长（variant C，延后问题）
- 不做 SSE 连接数驱动的双向 timer（variant B，scope 更大）
- 不做 fork / compact 的测试覆盖（评审 §4 列了但属独立工作）
- 不重构 `AgentSessionWrapper`
- 不让 idle timeout 可配置

## 方案概览（方案 A：heartbeat 重置 timer）

最小改动：

- `lib/rpc-manager.ts`：在 `AgentSessionWrapper` 上加公开方法 `keepAlive()`，调用现有的私有 `resetIdleTimer()`。
- `app/api/agent/[id]/events/route.ts`：heartbeat 把 `session.keepAlive()` 放在 `enqueue` 成功的同一 try 块内 —— 仅当 heartbeat 成功到达客户端时才重置 timer。
- `lib/rpc-manager.test.ts`（新文件）：3 个 fake-timer 测试覆盖核心不变量。

## `lib/rpc-manager.ts`

新增方法：

```typescript
/**
 * Signal that this wrapper is still in use (e.g., SSE heartbeat).
 * Resets the idle timer without emitting any events.
 */
keepAlive(): void {
  this.resetIdleTimer();
}
```

放在 `onDestroy` 之后、`send` 之前。无新逻辑，复用 `resetIdleTimer`。

## `app/api/agent/[id]/events/route.ts`

heartbeat 块改造：

```typescript
// before
const heartbeat = setInterval(() => {
  try {
    controller.enqueue(new TextEncoder().encode(":\n\n"));
  } catch {
    // controller already closed
  }
}, 30_000);

// after
const heartbeat = setInterval(() => {
  try {
    controller.enqueue(new TextEncoder().encode(":\n\n"));
    session.keepAlive();
  } catch {
    // controller already closed; do not call keepAlive so the idle
    // timer can eventually destroy the wrapper (no orphan).
  }
}, 30_000);
```

**关键设计点**：`keepAlive` 放在 `enqueue` 之后、`try` 块内。如果客户端断开（enqueue 抛错），跳过 keepAlive，timer 正常到期 → wrapper 销毁。**不引入新 catch 逻辑**，复用现有的"controller already closed"分支。

## 数据流

```
client opens SSE
  │
  ├─ server: subscribe to pi events
  ├─ server: setInterval(30s) → heartbeat
  │    each tick:
  │      ├─ controller.enqueue(":\n\n")
  │      │     └─ success → session.keepAlive() → resetIdleTimer()
  │      └─ throw (client gone) → catch → no keepAlive → timer eventually fires → destroy
  │
  └─ on client disconnect / browser close:
       req.signal.abort → cleanup() → clearInterval(heartbeat) + unsubscribe
```

## 错误处理

| 场景 | 行为 |
|---|---|
| 客户端正常断开 | `req.signal.abort` → cleanup → heartbeat 停止 → idle timer 正常到期 |
| 客户端静默消失（无 FIN） | enqueue 抛错 → 跳过 keepAlive → timer 正常到期 |
| 服务端 pi 抛错 | `subscribe` 回调不会重新抛；不影响 timer |
| `keepAlive()` 在已 destroy 的 wrapper 上调用 | `resetIdleTimer` 内部 `if (this.idleTimer) clearTimeout(this.idleTimer)` 安全（无 timer 时 clearTimeout 是 no-op） |

## 测试策略

### `lib/rpc-manager.test.ts`（新文件，3 个测试）

用 `node:test` 的 `mock.timers` + 最小 `AgentSessionLike` stub：

1. **wrapper is destroyed after 10 min of inactivity**
   - `start()` 后 tick 9 min → 仍 alive
   - 再 tick 1 min（10 min 累计）→ destroyed

2. **keepAlive resets the idle timer**
   - `start()` 后 tick 9 min → alive
   - `keepAlive()` 调用
   - 再 tick 9 min → 仍 alive
   - 再 tick 1 min（10 min since keepAlive）→ destroyed

3. **events reset the idle timer (regression)**
   - 捕获 `subscribe` 回调
   - tick 9 min → alive
   - 触发回调（模拟 pi 事件）→ 重置
   - 再 tick 9 min → alive
   - 再 tick 1 min → destroyed

### 不写 SSE route 的集成测试

SSE route 是 Next.js route handler + ReadableStream，集成测试要 mock 大量东西。改动的核心逻辑是 heartbeat 内一行调用，价值低于成本。手动验证即可。

### 手动验证清单（写进 PR description）

- [ ] 启动 dev，浏览器发送消息触发 agent 运行；等 agent 进入 LLM 思考期；观察 DevTools Network 面板 SSE 收到 `:` comment frames；保持页面打开 > 10 分钟（用一个真正的长时间任务或简单的 "tell me a long story" prompt）；验证 wrapper 仍 alive（不会"连接已断开"）
- [ ] 关闭浏览器 tab，验证 wrapper 在 ~10 分钟后被销毁（可通过 `globalThis.__piSessions` 引用计数间接观察，或在下一个请求时观察 wrapper 是新创建的还是复用的）

## 范围外（本次 P0-2 不做）

- variant B（SSE 连接数驱动双向 timer）
- variant C（延长到 30 min）
- fork / compact 测试覆盖
- `AgentSessionWrapper` 重构
- idle timeout 配置化
- abort / cleanup 路径本身（依赖现有 `req.signal?.addEventListener("abort", cleanup)`）

## 风险

| 风险 | 缓解 |
|---|---|
| `mock.timers` 在某些 Node 版本不支持 | 项目用 Node 20.12+（`bin/pi-web.js` 已绕过 Node ≥ 20.12 的 npx.cmd CVE），`mock.timers` 在 Node 20+ 可用 |
| `AgentSessionLike` stub 字段不全导致 wrapper 抛错 | 用 `as never` 强转；只在 `start()` 路径调用 `subscribe`，测试不触发其他方法 |
| heartbeat 把 `keepAlive` 放 `try` 块内带来性能开销 | `try` 是无开销的，调用本身也只是 `clearTimeout` + `setTimeout`，可忽略 |
| 用户开了多个 tab | 每个 tab 有独立 SSE + 独立 heartbeat，都调 `keepAlive`，timer 一直被重置 —— 这是预期行为，浪费 < 1 KB 内存 |

## 验证清单

- [ ] `node --test lib/rpc-manager.test.ts` 通过（3 tests）
- [ ] `node --test lib/*.test.ts electron/*.test.ts 'app/**/*.test.ts'` 通过
- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run lint` 通过
- [ ] 手动验证 2 条通过

## 实施顺序

1. `lib/rpc-manager.test.ts` 写 3 个测试（先 fail，因 `keepAlive` 不存在）
2. `lib/rpc-manager.ts` 加 `keepAlive()` 方法
3. 跑 rpc-manager 测试 → pass
4. `app/api/agent/[id]/events/route.ts` heartbeat 加 `session.keepAlive()`
5. tsc + lint + 全量测试
6. commit

## PR 范围

- 2 文件修改（`lib/rpc-manager.ts`、`app/api/agent/[id]/events/route.ts`）
- 1 文件新增（`lib/rpc-manager.test.ts`）
- 总计 ~70 行变动
- 一个 commit，一个 PR
