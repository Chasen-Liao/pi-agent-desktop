# P0-1 JSONL 写并发安全设计

> 分支：`analysis/architecture-optimization-review` · 日期：2026-06-01 · 关联评审：`docs/architecture-review-2026-06-01.md` §1 P0-1

## 背景

`DELETE /api/sessions/[id]` 在删除父会话时会扫描同目录的 sibling `.jsonl` 文件，对每个 `parentSession === filePath` 的子文件做 `readFileSync → JSON.parse → mutate → writeFileSync` 级联重写。当前实现既无锁也非原子写：两个并发 DELETE 会交叉覆盖；reader 在写中间也可能读到撕裂的 JSONL。详见评审 doc P0-1 条目。

## 目标

DELETE 路径在并发场景下保证：

- 同一文件的写操作串行化
- 单次写对其他 reader 原子可见
- 纯函数层可独立单测，覆盖级联改写的所有边界
- 不引入新 npm 依赖，不动 GET/PATCH/其他路由

## 非目标

- 不做跨进程锁（Electron 单进程 + npm CLI 单进程，威胁模型不适用）
- 不做 per-directory 锁（over-engineering）
- 不异步化 `readFileSync`/`readdirSync`（保持现有同步风格）
- 不引入 zod 做 JSON 解析校验（orthogonal 改进，留 P1-1）
- 不修复 GET/PATCH 路径的潜在竞态（无级联，单文件风险低于 DELETE）

## 方案概览

抽两个新文件、改一个 route handler、加两个测试文件：

- `lib/session-lock.ts`（新）：进程内文件级写锁，基于 `globalThis.__piWriteLocks` 的 promise chain
- `lib/session-cascade.ts`（新）：纯函数 `rewriteChildHeader(content, oldParent, newParent) → { newContent, changed }`
- `app/api/sessions/[id]/route.ts`（改）：DELETE 改用上面两个 + tmp+rename 原子写
- `lib/session-lock.test.ts`（新）：锁原语并发测试
- `lib/session-cascade.test.ts`（新）：纯函数单元测试

## `lib/session-lock.ts`

文件级写锁。Map 键用 `path.resolve` 归一化。同一路径的 `withFileLock` 调用串行执行；不同路径互不阻塞。

```typescript
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T>
```

实现要点：

- `globalThis.__piWriteLocks: Map<string, Promise<unknown>>` —— 复用 CLAUDE.md 强调的 `globalThis` 模式，确保 Next.js 热重载安全
- 每个调用把自己的 gate promise 接在前一个的 `.then` 上；前一个完成 → 当前获得锁
- `finally` 释放自己的 gate，并在 map 仍指向自己时清理 entry（避免无意义累积）
- 不支持同一路径重入（reentrancy 会死锁）。本 codebase 不会有调用方重入，文档明示即可

## `lib/session-cascade.ts`

纯函数。输入 child 文件的全文和父/新父路径，输出新全文和是否变更。**不碰 I/O。**

```typescript
export interface RewriteResult {
  newContent: string;
  changed: boolean;
}

export function rewriteChildHeader(
  content: string,
  oldParent: string,
  newParent: string | null,
): RewriteResult
```

行为：

- 解析第一行 JSON；如果解析失败或 `type !== "session"` 或 `parentSession !== oldParent` → 返回 `{ newContent: content, changed: false }`
- 否则把 `parentSession` 改为 `newParent`（`null` 时删除该键），重新序列化第一行，拼接剩余内容
- 第一行之外的所有字节原样保留（包括尾部换行）

## `app/api/sessions/[id]/route.ts` 的 DELETE 改写

保持 async signature。同步部分（readFileSync、readdirSync）保留以匹配现有风格；所有写操作改为 `await withFileLock(..., () => atomicWriteFile(...))`。

新流程：

1. `resolveSessionPath(id)` → 缺失返回 404
2. `readFileSync(parent)` 取第一行 JSON.parse，提取 grandparent（`parentSession ?? null`）。malformed 视为 grandparent 为 null
3. `readdirSync(parent dir)` → 过滤出 sibling `.jsonl`
4. 对每个 sibling：同步 `readFileSync` → `rewriteChildHeader` 判断 → 若 changed 则 `await withFileLock(child, () => atomicWriteFile(child, newContent))`
5. `await withFileLock(parent, () => { try { unlinkSync(parent); } catch {} })` —— 即使 unlink 失败（race：已被删）也吞掉
6. `invalidateSessionPathCache(id)` → 200

`atomicWriteFile` 内联在 route 文件内（一次性 helper，不抽到 lib）：

```typescript
async function atomicWriteFile(p: string, content: string) {
  const tmp = `${p}.tmp`;
  await writeFile(tmp, content, "utf8");
  try { await rename(tmp, p); }
  catch (e) { try { await unlink(tmp); } catch {}; throw e; }
}
```

## 数据流

```
DELETE /api/sessions/{id}
  │
  ├─ resolveSessionPath(id) ─────────────────── 404 if missing
  │
  ├─ readFileSync(parent) → first line → grandparent
  │
  ├─ readdirSync(dir) → siblings
  │
  ├─ for each sibling:
  │    ├─ readFileSync(sibling)               (sync; 失败 skip)
  │    ├─ rewriteChildHeader(content, parent, grandparent)  (pure)
  │    └─ if changed:
  │         └─ withFileLock(sibling, atomicWriteFile(sibling, newContent))
  │
  ├─ withFileLock(parent, unlinkSync(parent))   (吞 unlink 失败)
  │
  └─ invalidateSessionPathCache(id) → 200
```

## 错误处理

| 失败点 | 行为 | 状态码 |
|---|---|---|
| `resolveSessionPath` 返 null | 404 | 404 |
| `readdirSync` 失败 | 跳过 cascade，直接走 unlink | 200 |
| 单个 child `readFileSync` 失败 | skip 该 child，继续处理其他 | 200 |
| `rewriteChildHeader` 解析失败 | skip（视 malformed） | 200 |
| `atomicWriteFile` 抛错 | 上抛外层 catch，**parent 不会被 unlink** | 500（半失败：children 已改写，parent 仍存在，可重试） |
| `unlinkSync(parent)` 失败（race） | 吞掉，cascade 已完成 | 200 |
| `withFileLock` 内部 fn 抛 | finally 释放锁，错误上抛 | 500 |

**不做的**：级联回滚。半失败时已改写的 child 保留新 `parentSession`。重试时它们被 `rewriteChildHeader` 再次判断为"parentSession !== filePath"（filePath 还在），no-op。语义自洽。

## 测试策略

### `lib/session-cascade.test.ts`（纯函数单测，无 I/O）

- rewrites child when parentSession matches oldParent
- leaves child unchanged when parentSession is different
- leaves child unchanged when header is malformed JSON
- leaves child unchanged when type is not "session"
- removes parentSession when newParent is null（key 被删，不是被设为 `null`）
- preserves all other header fields
- preserves rest of file content beyond first line
- handles empty content
- handles content without trailing newline

### `lib/session-lock.test.ts`（锁原语并发测试）

- serializes 100 concurrent calls on same path — 所有 fn 串行执行，每个 fn 看到正确的 `prev === next` 时序
- does not block calls on different paths —— 用 `Promise.all` 跑两个不同 path，断言总耗时 < 两个串行执行的耗时之和
- releases lock when fn throws —— 抛错后下一个调用能立即获得锁
- cleanup: map entry removed after release —— finally 后 map 不再包含已完成的 entry

### 不写 DELETE route 集成测试

route 是上面两个已测单元的编排，加 sync I/O 的胶水。集成测试需要 mock 整个文件系统，价值低于成本。手动验证清单如下。

### 手动验证清单（写进 PR description）

- 删一个有子会话的父 → 验证子会话在 sidebar 重新挂到 grandparent
- 同时打开两个浏览器 tab 登同一 cwd，分别删父和子 → 观察文件无损坏
- 手动改坏一个 child jsonl 的第一行触发 cascade → 验证 DELETE 仍能完成（malformed child 被 skip，其他 child 正常改写）
- 删一个没有 parentSession 的根会话（grandparent 为 null）→ 验证 child 的 parentSession 被移除（不是被设为 `null`）

## 范围外（本次 P0-1 不做）

- 异步化 sync I/O
- 跨进程锁
- per-directory 锁
- JSON parse 用 zod 校验
- GET/PATCH 路径的潜在竞态

## 风险

| 风险 | 缓解 |
|---|---|
| `${p}.tmp` 失败时残留 | 后续 atomicWrite 覆盖；用户可手动清理 |
| 锁链内存泄漏 | finally 一定 release；hot-reload 全局重置 |
| Windows rename 行为差异 | Node.js 在 Windows 上用 `MOVEFILE_REPLACE_EXISTING`，行为正确 |
| withFileLock 重入死锁 | 文档明示不支持；codebase 无调用方重入 |

## 验证清单

- [ ] `node --test lib/session-lock.test.ts lib/session-cascade.test.ts` 通过
- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run lint` 通过
- [ ] 手动验证清单 4 条全部通过

## 实施顺序

1. 写 `lib/session-cascade.ts` 和 `lib/session-cascade.test.ts`（纯函数优先，TDD 干净）
2. 写 `lib/session-lock.ts` 和 `lib/session-lock.test.ts`（同样 TDD）
3. 改 `app/api/sessions/[id]/route.ts` 的 DELETE（最后一步，组合两个新模块）
4. 跑验证清单

## PR 范围

- 3 个 src 文件新增/修改
- 2 个测试文件新增
- 总计 ~150 行 src + ~120 行测试
- 一个 commit，一个 PR
