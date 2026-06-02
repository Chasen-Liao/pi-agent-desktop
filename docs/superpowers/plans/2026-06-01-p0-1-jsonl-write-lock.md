# P0-1 JSONL 写并发安全 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DELETE /api/sessions/[id] 路径在并发场景下保证 JSONL 文件写串行化 + 单次写原子可见，并通过纯函数层单测覆盖级联改写的所有边界。

**Architecture:** 抽两个新文件（`lib/session-cascade.ts` 纯函数 + `lib/session-lock.ts` 进程内文件级写锁），promise chain + `globalThis` Map 实现锁；DELETE route 用 `withFileLock(atomicWriteFile)` 串行化所有 child 改写和 parent unlink。

**Tech Stack:** Node 20+、TypeScript 5 (strict)、ESM only、`node --test`。无新依赖。

**Spec:** `docs/superpowers/specs/2026-06-01-p0-1-jsonl-write-lock-design.md`

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `lib/session-cascade.ts` | 新建 | 纯函数 `rewriteChildHeader(content, oldParent, newParent) → { newContent, changed }` |
| `lib/session-cascade.test.ts` | 新建 | 9 个单元测试 |
| `lib/session-lock.ts` | 新建 | 进程内文件级写锁 `withFileLock(path, fn)` |
| `lib/session-lock.test.ts` | 新建 | 4 个并发测试 |
| `app/api/sessions/[id]/route.ts` | 修改 | DELETE handler 用 cascade + lock + atomicWriteFile |

`atomicWriteFile` 内联在 route 内（一次性 helper，不抽到 lib）。

---

## Task 1: 纯函数 `rewriteChildHeader`

**Files:**
- Create: `lib/session-cascade.test.ts`
- Create: `lib/session-cascade.ts`

- [ ] **Step 1.1: 写 9 个失败测试**

Create `lib/session-cascade.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteChildHeader } from "./session-cascade";

const sampleChild = (parent: string | undefined) => ({
  type: "session",
  version: 3,
  id: "child-uuid",
  timestamp: "2026-06-01T00:00:00Z",
  cwd: "/tmp/test",
  ...(parent !== undefined ? { parentSession: parent } : {}),
});

const format = (header: object) =>
  JSON.stringify(header) + "\n" +
  JSON.stringify({ type: "message", id: "m1", parentId: null, message: { role: "user", content: "hi" } }) + "\n";

test("rewrites child when parentSession matches oldParent", () => {
  const oldParent = "/sessions/parent.jsonl";
  const newParent = "/sessions/grandparent.jsonl";
  const content = format(sampleChild(oldParent));
  const { newContent, changed } = rewriteChildHeader(content, oldParent, newParent);
  assert.equal(changed, true);
  const newHeader = JSON.parse(newContent.split("\n")[0]);
  assert.equal(newHeader.parentSession, newParent);
  assert.equal(newHeader.id, "child-uuid");
});

test("leaves child unchanged when parentSession is different", () => {
  const content = format(sampleChild("/sessions/other.jsonl"));
  const { newContent, changed } = rewriteChildHeader(
    content,
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, false);
  assert.equal(newContent, content);
});

test("leaves child unchanged when header is malformed JSON", () => {
  const content = "not json at all\n" + JSON.stringify({ type: "message" });
  const { newContent, changed } = rewriteChildHeader(
    content,
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, false);
  assert.equal(newContent, content);
});

test("leaves child unchanged when type is not 'session'", () => {
  const content = JSON.stringify({ type: "message", id: "m1" }) + "\n";
  const { newContent, changed } = rewriteChildHeader(
    content,
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, false);
  assert.equal(newContent, content);
});

test("removes parentSession when newParent is null", () => {
  const oldParent = "/sessions/parent.jsonl";
  const content = format(sampleChild(oldParent));
  const { newContent, changed } = rewriteChildHeader(content, oldParent, null);
  assert.equal(changed, true);
  const newHeader = JSON.parse(newContent.split("\n")[0]);
  assert.equal("parentSession" in newHeader, false);
  assert.equal(newHeader.id, "child-uuid");
});

test("preserves all other header fields", () => {
  const header = {
    type: "session",
    version: 3,
    id: "child-uuid",
    timestamp: "2026-06-01T00:00:00Z",
    cwd: "/tmp/test",
    customField: "preserved",
    nested: { a: 1, b: 2 },
    parentSession: "/sessions/parent.jsonl",
  };
  const content = JSON.stringify(header) + "\n";
  const { newContent, changed } = rewriteChildHeader(
    content,
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, true);
  const newHeader = JSON.parse(newContent.split("\n")[0]);
  assert.equal(newHeader.customField, "preserved");
  assert.deepEqual(newHeader.nested, { a: 1, b: 2 });
});

test("preserves rest of file content beyond first line", () => {
  const line1 = JSON.stringify(sampleChild("/sessions/parent.jsonl"));
  const line2 = JSON.stringify({ type: "message", id: "m1", parentId: null, message: { role: "user", content: "hi" } });
  const line3 = JSON.stringify({ type: "message", id: "m2", parentId: "m1", message: { role: "assistant", content: [] } });
  const content = line1 + "\n" + line2 + "\n" + line3 + "\n";
  const { newContent, changed } = rewriteChildHeader(
    content,
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, true);
  const lines = newContent.split("\n");
  assert.equal(JSON.parse(lines[0]).parentSession, "/sessions/grandparent.jsonl");
  assert.equal(lines[1], line2);
  assert.equal(lines[2], line3);
  assert.equal(lines[3], "");
});

test("handles empty content", () => {
  const { newContent, changed } = rewriteChildHeader(
    "",
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, false);
  assert.equal(newContent, "");
});

test("handles content without trailing newline", () => {
  const line1 = JSON.stringify(sampleChild("/sessions/parent.jsonl"));
  const line2 = JSON.stringify({ type: "message", id: "m1" });
  const content = line1 + "\n" + line2;
  const { newContent, changed } = rewriteChildHeader(
    content,
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, true);
  const lines = newContent.split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).parentSession, "/sessions/grandparent.jsonl");
  assert.equal(lines[1], line2);
});
```

- [ ] **Step 1.2: 运行测试，验证失败**

Run: `node --test lib/session-cascade.test.ts`
Expected: FAIL with `Cannot find module './session-cascade'` or similar module-not-found.

- [ ] **Step 1.3: 实现 `rewriteChildHeader`**

Create `lib/session-cascade.ts`:

```typescript
export interface RewriteResult {
  newContent: string;
  changed: boolean;
}

/**
 * Pure function: decide whether to rewrite a child session file's first-line
 * header to change its `parentSession` from `oldParent` to `newParent`.
 *
 * - If the first line is malformed JSON, type is not "session", or
 *   parentSession doesn't match oldParent, returns { newContent: content,
 *   changed: false }.
 * - If newParent is null, removes the parentSession key from the header
 *   (not sets it to null).
 * - Preserves all other header fields and all content beyond the first line.
 */
export function rewriteChildHeader(
  content: string,
  oldParent: string,
  newParent: string | null,
): RewriteResult {
  if (content.length === 0) return { newContent: content, changed: false };

  const newlineIdx = content.indexOf("\n");
  const firstLineRaw = newlineIdx === -1 ? content : content.slice(0, newlineIdx);
  const rest = newlineIdx === -1 ? "" : content.slice(newlineIdx);

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(firstLineRaw) as Record<string, unknown>;
  } catch {
    return { newContent: content, changed: false };
  }

  if (header.type !== "session" || header.parentSession !== oldParent) {
    return { newContent: content, changed: false };
  }

  if (newParent === null) {
    delete header.parentSession;
  } else {
    header.parentSession = newParent;
  }

  return { newContent: JSON.stringify(header) + rest, changed: true };
}
```

- [ ] **Step 1.4: 运行测试，验证通过**

Run: `node --test lib/session-cascade.test.ts`
Expected: PASS — all 9 tests.

- [ ] **Step 1.5: 提交**

```bash
git add lib/session-cascade.ts lib/session-cascade.test.ts
git commit -m "feat(session-cascade): pure rewriteChildHeader for parent reparenting"
```

---

## Task 2: 文件级写锁 `withFileLock`

**Files:**
- Create: `lib/session-lock.test.ts`
- Create: `lib/session-lock.ts`

- [ ] **Step 2.1: 写 4 个失败测试**

Create `lib/session-lock.test.ts`:

```typescript
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { withFileLock } from "./session-lock";

declare global {
  // eslint-disable-next-line no-var
  var __piWriteLocks: Map<string, Promise<unknown>> | undefined;
}

beforeEach(() => {
  globalThis.__piWriteLocks = undefined;
});

test("serializes 100 concurrent calls on same path", async () => {
  const target = path.resolve("/tmp/lock-test-A");
  const order: number[] = [];
  const tasks = Array.from({ length: 100 }, (_, i) =>
    withFileLock(target, async () => {
      const prev = order[order.length - 1] ?? -1;
      assert.equal(i, prev + 1, `task ${i} ran out of order (prev was ${prev})`);
      order.push(i);
      await new Promise((r) => setImmediate(r));
    }),
  );
  await Promise.all(tasks);
  assert.equal(order.length, 100);
  assert.equal(order[0], 0);
  assert.equal(order[99], 99);
});

test("does not block calls on different paths", async () => {
  const a = path.resolve("/tmp/lock-test-B");
  const b = path.resolve("/tmp/lock-test-C");
  const start = Date.now();
  await Promise.all([
    withFileLock(a, async () => {
      await new Promise((r) => setTimeout(r, 100));
    }),
    withFileLock(b, async () => {
      await new Promise((r) => setTimeout(r, 100));
    }),
  );
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 180, `expected < 180ms, got ${elapsed}ms`);
});

test("releases lock when fn throws", async () => {
  const target = path.resolve("/tmp/lock-test-D");
  await assert.rejects(
    withFileLock(target, async () => {
      throw new Error("intentional");
    }),
    /intentional/,
  );
  const start = Date.now();
  await withFileLock(target, async () => {});
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 50, `lock not released: ${elapsed}ms wait`);
});

test("cleans up map entry after release", async () => {
  const target = path.resolve("/tmp/lock-test-E");
  await withFileLock(target, async () => {});
  const map = globalThis.__piWriteLocks;
  if (map !== undefined) {
    assert.equal(map.has(target), false, "map should not contain entry after release");
  }
});
```

- [ ] **Step 2.2: 运行测试，验证失败**

Run: `node --test lib/session-lock.test.ts`
Expected: FAIL with `Cannot find module './session-lock'`.

- [ ] **Step 2.3: 实现 `withFileLock`**

Create `lib/session-lock.ts`:

```typescript
import path from "node:path";

declare global {
  // eslint-disable-next-line no-var
  var __piWriteLocks: Map<string, Promise<unknown>> | undefined;
}

/**
 * Acquire a process-level write lock on a file path, run `fn`, then release.
 *
 * - Per-file granularity: different paths do not block each other.
 * - Reentrancy NOT supported: calling withFileLock(samePath) inside a fn
 *   holding the lock will deadlock.
 * - Map entry is cleaned up after release if no later caller has chained on.
 * - globalThis is used to survive Next.js hot reloads (matches the
 *   __piSessions / __piStartLocks pattern in lib/rpc-manager.ts).
 */
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(filePath);
  const locks = (globalThis.__piWriteLocks ??= new Map<string, Promise<unknown>>());

  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ourEntry = prev.then(() => gate);
  locks.set(key, ourEntry);

  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (locks.get(key) === ourEntry) {
      locks.delete(key);
    }
  }
}
```

- [ ] **Step 2.4: 运行测试，验证通过**

Run: `node --test lib/session-lock.test.ts`
Expected: PASS — all 4 tests.

- [ ] **Step 2.5: 提交**

```bash
git add lib/session-lock.ts lib/session-lock.test.ts
git commit -m "feat(session-lock): process-level file write lock"
```

---

## Task 3: 改造 DELETE handler

**Files:**
- Modify: `app/api/sessions/[id]/route.ts` (import block + DELETE handler)

- [ ] **Step 3.1: 替换 import 块**

In `app/api/sessions/[id]/route.ts`, replace the import block (lines 1-11) with:

```typescript
import { NextResponse } from "next/server";
import { readdirSync, readFileSync, statSync, unlinkSync } from "fs";
import { writeFile, rename, unlink } from "fs/promises";
import { join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  resolveSessionPath,
  invalidateSessionPathCache,
  buildSessionContext,
  listAllSessions,
} from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { rewriteChildHeader } from "@/lib/session-cascade";
import { withFileLock } from "@/lib/session-lock";
```

变更：
- 移除 `writeFileSync`（不再使用）
- 新增 `import { writeFile, rename, unlink } from "fs/promises"` 给 atomicWriteFile
- 新增 cascade + lock 的 import

- [ ] **Step 3.2: 替换 DELETE 函数 + 新增 atomicWriteFile helper**

替换 `app/api/sessions/[id]/route.ts` 中 line 102-150（整个 DELETE handler）为：

```typescript
// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // 1. Read parent's first line to get grandparent path
    let parentSessionPath: string | null = null;
    try {
      const firstLine = readFileSync(filePath, "utf8").split("\n")[0];
      const header = JSON.parse(firstLine) as { type?: string; parentSession?: string };
      if (header.type === "session") parentSessionPath = header.parentSession ?? null;
    } catch { /* malformed parent — grandparent remains null */ }

    // 2. Enumerate siblings
    const dir = filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    const siblingFiles: string[] = [];
    try {
      siblingFiles.push(
        ...readdirSync(dir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => join(dir, f))
          .filter((p) => p !== filePath)
      );
    } catch { /* dir unreadable — no cascade possible */ }

    // 3. Identify and rewrite children (under per-file lock, atomic write)
    for (const childPath of siblingFiles) {
      let content: string;
      try { content = readFileSync(childPath, "utf8"); }
      catch { continue; /* race: child deleted between readdir and read */ }

      const { newContent, changed } = rewriteChildHeader(content, filePath, parentSessionPath);
      if (!changed) continue;

      await withFileLock(childPath, () => atomicWriteFile(childPath, newContent));
    }

    // 4. Unlink parent (under lock, swallow race-condition unlink failure)
    await withFileLock(filePath, () => {
      try { unlinkSync(filePath); } catch { /* race: already deleted */ }
    });
    invalidateSessionPathCache(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function atomicWriteFile(p: string, content: string): Promise<void> {
  const tmp = `${p}.tmp`;
  await writeFile(tmp, content, "utf8");
  try {
    await rename(tmp, p);
  } catch (e) {
    try { await unlink(tmp); } catch { /* best effort */ }
    throw e;
  }
}
```

- [ ] **Step 3.3: 类型检查 + lint**

Run: `npx tsc --noEmit`
Expected: 通过，无错误。

Run: `npm run lint`
Expected: 通过，无错误。

- [ ] **Step 3.4: 提交**

```bash
git add app/api/sessions/[id]/route.ts
git commit -m "fix(sessions-delete): cascade reparent under file lock + atomic write"
```

---

## Task 4: 验证

- [ ] **Step 4.1: 跑新增测试**

Run: `node --test lib/session-cascade.test.ts lib/session-lock.test.ts`
Expected: 全部通过（13 tests: 9 cascade + 4 lock）。

- [ ] **Step 4.2: 跑全量测试套件**

Run: `node --test lib/*.test.ts electron/*.test.ts 'app/**/*.test.ts'`
Expected: 全部通过（已有测试 + 新增 13 个）。

- [ ] **Step 4.3: 类型检查 + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 通过。

- [ ] **Step 4.4: 手动验证（写进 PR description）**

- [ ] 启动 dev (`npm run dev`)，浏览器创建父会话、发消息、fork 子会话
- [ ] 删父会话，验证子会话在 sidebar 重新挂到 grandparent
- [ ] 同时打开两个浏览器 tab 登同一 cwd，分别删父和子；用 `head -1 <file>.jsonl` 看第一行是合法 JSON
- [ ] 手动改坏一个 child jsonl 的第一行（比如改成 `not json`），触发 cascade；验证 DELETE 仍能完成（malformed child 被 skip，其他 child 正常改写）
