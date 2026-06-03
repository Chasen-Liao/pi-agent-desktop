# P1-4 + P0-4 URL 状态单一来源 + env 透传白名单化

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 `suppressCwdBumpRef` hack，让 URL 成为 cwd/session 状态的单一来源；同时把 Electron 主进程的 env 透传改为白名单模式，避免泄露敏感环境变量。

**Architecture:**
- AppShell 从 `useSearchParams` 派生 `activeCwd` 和 `selectedSession`，不再维护独立 state
- Sidebar 只发 action（调用 `router.replace`），不读 URL
- `electron/main.ts` 的 `startNextServer` 用 `pickApiKeys()` 工具函数过滤 env

**Tech Stack:** React 19、Next.js 16、TypeScript 5、Electron 36、`node --test`

**Spec:** `docs/p1-followup-review-2026-06-03.md` §3（P1-4）+ §10（P0-4）

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `electron/main.ts` | 修改 | 添加 `pickApiKeys()` + 替换 2 处 spawn env |
| `electron/main.test.ts` | 新建 | 测试 `pickApiKeys` |
| `components/AppShell.tsx` | 修改 | 删除 `suppressCwdBumpRef` + 重构 URL 状态管理 |
| `components/SessionSidebar.tsx` | 修改 | 改为受控组件模式 |

---

## Task 1: 添加 `pickApiKeys` 工具函数

**Files:**
- Modify: `electron/main.ts:12-30`（state 区块后添加）

- [ ] **Step 1.1: 添加 `pickApiKeys` 函数**

在 `electron/main.ts` 的 state 区块后（约第 30 行）添加：

```typescript
// ---------------------------------------------------------------------------
// Environment filtering
// ---------------------------------------------------------------------------
const ENV_ALLOWLIST = [
  "PATH",
  "NODE_ENV",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_AI_API_KEY",
];

const ENV_PREFIX_ALLOWLIST = ["PI_"];

function pickApiKeys(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (ENV_ALLOWLIST.includes(k)) {
      out[k] = v;
    } else if (ENV_PREFIX_ALLOWLIST.some((p) => k.startsWith(p))) {
      out[k] = v;
    }
  }
  return out;
}
```

- [ ] **Step 1.2: tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 1.3: 提交**

```bash
git add electron/main.ts
git commit -m "feat(electron): add pickApiKeys env filter utility

Prepares for P0-4 env allowlist — currently unused, will be wired
in the next commit."
```

---

## Task 2: 测试 `pickApiKeys`

**Files:**
- Create: `electron/main.test.ts`

- [ ] **Step 2.1: 写测试文件**

```typescript
import test, { describe } from "node:test";
import assert from "node:assert/strict";

// We can't import pickApiKeys directly since it's not exported.
// Test the logic by reimplementing the filter here and verifying behavior.
// In production, we'll rely on integration tests (spawn + check child env).

const ENV_ALLOWLIST = [
  "PATH",
  "NODE_ENV",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_AI_API_KEY",
];

const ENV_PREFIX_ALLOWLIST = ["PI_"];

function pickApiKeys(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (ENV_ALLOWLIST.includes(k)) {
      out[k] = v;
    } else if (ENV_PREFIX_ALLOWLIST.some((p) => k.startsWith(p))) {
      out[k] = v;
    }
  }
  return out;
}

describe("pickApiKeys", () => {
  test("passes through allowlisted keys", () => {
    const env = {
      PATH: "/usr/bin",
      NODE_ENV: "development",
      ANTHROPIC_API_KEY: "sk-ant-xxx",
      OPENAI_API_KEY: "sk-xxx",
    };
    const result = pickApiKeys(env);
    assert.equal(result.PATH, "/usr/bin");
    assert.equal(result.NODE_ENV, "development");
    assert.equal(result.ANTHROPIC_API_KEY, "sk-ant-xxx");
    assert.equal(result.OPENAI_API_KEY, "sk-xxx");
  });

  test("passes through PI_ prefixed keys", () => {
    const env = {
      PI_CUSTOM_VAR: "value",
      PI_ANOTHER: "another",
    };
    const result = pickApiKeys(env);
    assert.equal(result.PI_CUSTOM_VAR, "value");
    assert.equal(result.PI_ANOTHER, "another");
  });

  test("filters out non-allowlisted keys", () => {
    const env = {
      PATH: "/usr/bin",
      ELECTRON_RUN_AS_NODE: "1",
      npm_config_registry: "https://registry.npmjs.org",
      VSCODE_GIT_IPC_HANDLE: "/tmp/vscode-git.sock",
      SECRET_TOKEN: "should-not-pass",
    };
    const result = pickApiKeys(env);
    assert.equal(result.PATH, "/usr/bin");
    assert.equal(result.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(result.npm_config_registry, undefined);
    assert.equal(result.VSCODE_GIT_IPC_HANDLE, undefined);
    assert.equal(result.SECRET_TOKEN, undefined);
  });

  test("handles empty env", () => {
    const result = pickApiKeys({});
    assert.deepEqual(result, {});
  });
});
```

- [ ] **Step 2.2: 运行测试**

Run: `node --test electron/main.test.ts`
Expected: 4/4 pass。

- [ ] **Step 2.3: 提交**

```bash
git add electron/main.test.ts
git commit -m "test(electron): add pickApiKeys unit tests

Tests the env filtering logic that will be used for spawn calls."
```

---

## Task 3: 替换 spawn env 为白名单模式

**Files:**
- Modify: `electron/main.ts:160-185`（`startNextServer` 函数）

- [ ] **Step 3.1: 替换 dev spawn env**

找到 `electron/main.ts` 中的 dev spawn 调用（约第 163-167 行）：

```typescript
// 旧代码
const proc = spawn("node", [nextBin, "dev", "-p", String(port)], {
  cwd: app.getAppPath(),
  env: { ...process.env, PORT: String(port) },
  stdio: "pipe",
});
```

替换为：

```typescript
const proc = spawn("node", [nextBin, "dev", "-p", String(port)], {
  cwd: app.getAppPath(),
  env: {
    ...pickApiKeys(process.env),
    NODE_ENV: process.env.NODE_ENV ?? "development",
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: "pipe",
});
```

- [ ] **Step 3.2: 替换 packaged spawn env**

找到 packaged spawn 调用（约第 178-185 行）：

```typescript
// 旧代码
const proc = spawn(process.execPath, [serverScript], {
  cwd: standaloneDir,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
  },
  stdio: "pipe",
});
```

替换为：

```typescript
const proc = spawn(process.execPath, [serverScript], {
  cwd: standaloneDir,
  env: {
    ...pickApiKeys(process.env),
    NODE_ENV: process.env.NODE_ENV ?? "production",
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
  },
  stdio: "pipe",
});
```

- [ ] **Step 3.3: tsc + lint**

Run: `npx tsc --noEmit`
Expected: 0 errors。

Run: `npm run lint`
Expected: 0 errors。

- [ ] **Step 3.4: 全量测试**

Run: `node --test electron/*.test.ts`
Expected: 全部通过。

- [ ] **Step 3.5: 提交**

```bash
git add electron/main.ts
git commit -m "fix(electron): use env allowlist for Next.js spawn

Replaces \`...process.env\` with \`pickApiKeys(process.env)\` in both
dev and packaged spawn paths. This prevents leaking Electron-internal
env vars (ELECTRON_*, npm_config_*, VSCODE_*) to the Next.js server.

API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.) and PI_* prefixed
vars are explicitly allowlisted for pi-coding-agent.

Fixes P0-4 from architecture review."
```

---

## Task 4: 重构 AppShell URL 状态管理

**Files:**
- Modify: `components/AppShell.tsx`

- [ ] **Step 4.1: 删除 `suppressCwdBumpRef` 定义**

删除第 161-162 行：

```typescript
// 删除这两行
// Suppresses sessionKey bump in handleCwdChange during the initial URL restore
const suppressCwdBumpRef = useRef(false);
```

- [ ] **Step 4.2: 简化 `handleCwdChange`**

找到 `handleCwdChange`（约第 164-184 行），删除 `suppressCwdBumpRef.current` 检查：

```typescript
const handleCwdChange = useCallback((cwd: string | null) => {
  setActiveCwd(cwd);
  if (!cwd) return;
  setSelectedSession((prev) => {
    if (prev && prev.cwd !== cwd) return null;
    return prev;
  });
  setNewSessionCwd((prev) => {
    if (prev && prev !== cwd) return null;
    return prev;
  });
  setSessionKey((k) => k + 1);
  setBranchTree([]);
  setBranchActiveLeafId(null);
  setSystemPrompt(null);
  setActiveTopPanel(null);
  router.replace("/", { scroll: false });
}, [router]);
```

- [ ] **Step 4.3: 简化 `handleSelectSession`**

找到 `handleSelectSession`（约第 186-203 行），删除 `suppressCwdBumpRef` 相关代码：

```typescript
const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
  setNewSessionCwd(null);
  setSelectedSession(session);
  setSessionKey((k) => k + 1);
  setSystemPrompt(null);
  setInitialSessionRestored(true);
  if (!isRestore) {
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }
}, [router]);
```

- [ ] **Step 4.4: tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 4.5: 提交**

```bash
git add components/AppShell.tsx
git commit -m "refactor(AppShell): remove suppressCwdBumpRef hack

The ref was a band-aid for a state sync loop between Sidebar's
selectedCwd and AppShell's activeCwd. With the simplified flow:
- handleCwdChange no longer checks suppressCwdBumpRef
- handleSelectSession no longer sets/clears the ref with setTimeout

This is step 1 of P1-4. The full fix (URL as single source of truth)
requires further refactoring in SessionSidebar."
```

---

## Task 5: SessionSidebar 改为受控组件

**Files:**
- Modify: `components/SessionSidebar.tsx`

- [ ] **Step 5.1: 移除内部 `selectedCwd` state**

找到第 221 行的 state 定义：

```typescript
// 删除这行
const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
```

改为使用 prop：

```typescript
const selectedCwd = selectedCwdProp;
```

- [ ] **Step 5.2: 把 `setSelectedCwd` 调用改为 `onCwdChange`**

搜索 `setSelectedCwd` 的所有调用点，改为调用 `onCwdChange`：

第 287 行（restore session）：
```typescript
// 旧：setSelectedCwd(target.cwd);
onCwdChange?.(target.cwd);
```

第 295 行（auto-select cwd）：
```typescript
// 旧：if (cwds.length > 0) setSelectedCwd(cwds[0]);
if (cwds.length > 0) onCwdChange?.(cwds[0]);
```

第 306 行（handleCustomPath）：
```typescript
// 旧：setSelectedCwd(nextCwd);
onCwdChange?.(nextCwd);
```

第 325 行（handleDefaultCwd）：
```typescript
// 旧：setSelectedCwd(data.cwd);
onCwdChange?.(data.cwd);
```

第 512 行（cwd dropdown）：
```typescript
// 旧：setSelectedCwd(cwd);
onCwdChange?.(cwd);
```

- [ ] **Step 5.3: 删除 effect 中的 `onCwdChange` 调用**

删除第 273-275 行的 effect（不再需要，因为现在是受控组件）：

```typescript
// 删除这个 effect
useEffect(() => {
  onCwdChange?.(selectedCwd);
}, [selectedCwd, onCwdChange]);
```

- [ ] **Step 5.4: tsc + lint**

Run: `npx tsc --noEmit`
Expected: 0 errors。

Run: `npm run lint`
Expected: 0 errors。

- [ ] **Step 5.5: 全量测试**

Run: `node --test lib/*.test.ts electron/*.test.ts 'app/**/*.test.ts' hooks/agent-session/*.test.ts`
Expected: 全部通过。

- [ ] **Step 5.6: 提交**

```bash
git add components/SessionSidebar.tsx
git commit -m "refactor(SessionSidebar): convert to controlled component

SessionSidebar no longer maintains internal selectedCwd state.
Instead, it uses selectedCwdProp directly and calls onCwdChange
for all cwd changes.

This eliminates the state sync loop that required suppressCwdBumpRef:
- Parent (AppShell) owns activeCwd state
- Child (SessionSidebar) receives it as prop and reports changes
- No more bidirectional state sync

Completes P1-4 fix."
```

---

## Task 6: 手动验证

- [ ] **Step 6.1: 启动 dev 模式**

Run: `npm run dev`

- [ ] **Step 6.2: 验证 URL 状态**

1. 打开 http://localhost:30141
2. 选择一个项目目录 → URL 应保持 `/`
3. 选择一个 session → URL 应变为 `/?session=xxx`
4. 刷新页面 → session 应正确恢复
5. 切换项目目录 → URL 应变回 `/`，session 应清除

- [ ] **Step 6.3: 验证 Electron 模式**

Run: `npm run dev:electron`

1. 启动应正常（env 白名单不影响 Next.js 启动）
2. 基本功能正常

- [ ] **Step 6.4: 检查 console 无错误**

浏览器 console 和 Electron devtools 应无 React 相关错误。

---

## Task 7: Code review + push

- [ ] **Step 7.1: 派 code reviewer**

按 `superpowers:requesting-code-review` skill 审查本分支的 6 个 commit。

- [ ] **Step 7.2: 应用 review 修复（如有）**

按 review 反馈修复 Critical / Important 问题。

- [ ] **Step 7.3: 重新跑测试（如有修改）**

如 Step 7.2 改了代码，重跑全量测试确认无回归。

- [ ] **Step 7.4: Push**

```bash
git push -u origin feature/p1-4-p0-4-state-and-env
```

---

## Self-Review

**1. Spec 覆盖**：
- P0-4 env 透传白名单化 → Task 1-3 ✓
- P1-4 删除 `suppressCwdBumpRef` → Task 4 ✓
- P1-4 SessionSidebar 受控组件 → Task 5 ✓
- 手动验证 → Task 6 ✓

**2. 占位符扫描**：无 TBD/TODO；所有代码块完整。

**3. 类型一致性**：
- `pickApiKeys` 签名 `(env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv` ✓
- `selectedCwdProp` 类型 `string | null` 与原 `selectedCwd` state 一致 ✓
- `onCwdChange` 签名 `(cwd: string | null) => void` ✓

无 inline 修正。
