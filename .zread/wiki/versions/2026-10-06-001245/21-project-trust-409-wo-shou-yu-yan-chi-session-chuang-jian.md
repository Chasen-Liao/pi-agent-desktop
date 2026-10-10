**Project Trust** 是 Pi Agent 桌面端的安全机制：当用户在包含**需信任资源**（如 `.pi/skills` 自定义技能目录）的项目中发起首次对话时，服务端拦截请求并返回 **HTTP 409**，要求用户通过 UI 明确授权后才会创建会话文件（`.jsonl`）并启动 Agent 进程。这种 **延迟 Session 创建** 设计确保了：未受信项目的代码永远不会被 Agent 读取、工具永远不会被调用、会话文件永远不会落盘。

本文档详细剖析 409 握手的完整流程、信任决策的持久化策略、会话级临时信任的内存实现，以及前后端协作的代码路径。

---

## 核心架构图

```mermaid
flowchart TD
    subgraph Client["前端 (React)"]
        A[用户发送首条消息] --> B[useSessionCommands.handleSend]
        B --> C[ensureTrustThenFetch POST /api/agent/new]
        C --> D{响应状态}
        D -->|200 OK| E[获得 sessionId, 连接 SSE]
        D -->|409 NeedsTrust| F[show ProjectTrustDialog]
        F --> G[用户选择选项]
        G --> H[POST /api/trust {cwd, optionId}]
        H --> I[ensureTrustThenFetch 重试原请求]
        I --> D
    end

    subgraph Server["后端 (Next.js API Routes)"]
        J[POST /api/agent/new] --> K[evaluateProjectTrust(cwd)]
        K --> L{hasTrustRequiringProjectResources?}
        L -->|否| M[直接创建 Session]
        L -->|是| N{已有持久化/会话级决策?}
        N -->|是| M
        N -->|否| O[返回 409 + NeedsTrustPayload]
        P[POST /api/trust] --> Q[applyTrustDecision]
        Q --> R[持久化或写入内存 Map]
    end

    subgraph TrustStore["信任存储"]
        S[(ProjectTrustStore\n~/.pi/agent/trust.json)]
        T[(sessionOnlyTrust Map\n内存, 进程生命周期)]
    end

    Q --> S
    Q --> T
    K --> S
    K --> T
```

**图示说明**：前端通过 `ensureTrustThenFetch` 实现自动重试；后端 `evaluateProjectTrust` 统一决策入口；信任决策分**持久化**（落盘 `trust.json`）与**会话级**（仅内存 `Map`）两种存储。

---

## 信任触发条件：何时需要 409 握手

`hasTrustRequiringProjectResources(cwd)`（来自 `@earendil-works/pi-coding-agent`）检查项目根目录下是否存在**需要显式授权的资源**。当前实现中，主要触发条件是：

| 资源类型 | 路径模式 | 说明 |
|----------|----------|------|
| `.pi/` 配置条目 | `.pi/settings.json`、`.pi/mcp.json`、`.pi/extensions/`、`.pi/skills/`、`.pi/prompts/`、`.pi/themes/`、`.pi/SYSTEM.md`、`.pi/APPEND_SYSTEM.md` | 对应 SDK 的 `TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES` 常量，任一条目**存在**即触发（如 `.pi/skills` 目录存在即可，与内容是否为 `*.md` 无关）；`.pi/mcp.json` 当下即触发 409，并非未来预留；列表中不存在 `.pi/tools/` |
| 仓库级技能目录 | `<cwd>` 及其任意祖先目录下的 `.agents/skills` | 用户全局 `~/.agents/skills` 始终视为受信资源，不触发 |

**测试用例验证** 了这一行为：空目录直接 `proceed`；创建 `.pi/skills/x.md` 后返回 `prompt`。

```typescript
// lib/project-trust-desktop.test.ts#L33-L53
test("project with .pi/skills and no decision → prompt", () => {
  const project = join(dir, "proj");
  mkdirSync(join(project, ".pi", "skills"), { recursive: true });
  writeFileSync(join(project, ".pi", "skills", "x.md"), "# skill\n");
  const r = evaluateProjectTrust(project, { agentDir });
  assert.equal(r.action, "prompt");
});
```

> **设计原则**：仅当项目包含**用户可控、可执行代码**的资源时才要求信任。普通源码文件（`.ts`, `.py` 等）不触发，因为 Agent 读取源码被视为只读操作，风险可控。

---

## 后端决策流程：`evaluateProjectTrust`

| `lib/project-trust-desktop.ts` 导出的 `evaluateProjectTrust` 是**唯一决策入口**，调用方包括：`POST /api/agent/new`、`POST /api/agent/[id]`（恢复已有会话同样返回 409）、`GET /api/agent/[id]/events`（SSE 连接建立前预检）以及 `/api/trust` GET。

```mermaid
flowchart TD
    Start[evaluateProjectTrust(cwd, options?)] --> ForceTrusted{forceTrusted?}
    ForceTrusted -->|是| ProceedTrusted[proceed + trusted=true]
    ForceTrusted -->|否| HasResources{hasTrustRequiringProjectResources?}
    HasResources -->|否| ProceedTrusted
    HasResources -->|是| SessionMap{sessionOnlyTrust.has(cwd)?}
    SessionMap -->|是| ProceedSession[proceed + trusted=map值]
    SessionMap -->|否| LoadStore[ProjectTrustStore.get(cwd)]
    LoadStore -->|true/false| ProceedPersisted[proceed + trusted=存储值]
    LoadStore -->|null/undefined| Prompt[prompt + NeedsTrustPayload]
```

**关键代码路径**：

```typescript
// lib/project-trust-desktop.ts#L53-L87
export function evaluateProjectTrust(
  cwd: string,
  options?: {
    agentDir?: string;
    sessionOnlyTrust?: Map<string, boolean>;
    forceTrusted?: boolean;
  }
): TrustGateResult {
  if (options?.forceTrusted) return { action: "proceed", trusted: true };
  if (!hasTrustRequiringProjectResources(cwd)) return { action: "proceed", trusted: true };

  const sessionMap = options?.sessionOnlyTrust;
  if (sessionMap?.has(cwd)) return { action: "proceed", trusted: sessionMap.get(cwd)! };

  const agentDir = options?.agentDir ?? getAgentDir();
  const store = new ProjectTrustStore(agentDir);
  const decision = store.get(cwd);
  if (decision === true || decision === false) return { action: "proceed", trusted: decision };

  return { action: "prompt", payload: { needsTrust: true, cwd, options: buildTrustOptions(cwd) } };
}
```

**决策优先级**（高 → 低）：
1. `forceTrusted: true` —— 会话级信任已确认，强制通过
2. 无需信任资源 —— 直接通过
3. **会话级内存 Map** —— 当前进程内临时决策
4. **持久化存储** —— `ProjectTrustStore` 读取 `~/.pi/agent/trust.json`
5. 无决策 —— 返回 `prompt`，触发 409

---

## 信任选项与持久化策略

`buildTrustOptions(cwd)` 生成 5 个选项，对应用户可执行的所有决策组合：

| optionId | label | trusted | persist | 说明 |
|----------|-------|---------|---------|------|
| `trust` | Trust | `true` | `true` | 永久信任当前项目，写入 `trust.json` |
| `trust-parent` | Trust parent folder | `true` | `true` | 信任父目录，当前项目标记为 `null`（继承） |
| `trust-session` | Trust (this session only) | `true` | `false` | 仅当前 Next.js 服务子进程（内存 Map）有效，重启失效 |
| `deny` | Do not trust | `false` | `true` | 永久拒绝，写入 `trust.json` |
| `deny-session` | Do not trust (this session only) | `false` | `false` | 仅当前进程拒绝 |

**`applyTrustDecision` 实现** 体现了两种存储路径的分流：

```typescript
// lib/project-trust-desktop.ts#L90-L130
export function applyTrustDecision(
  cwd: string,
  optionId: TrustOptionId,
  options?: { agentDir?: string; sessionOnlyTrust?: Map<string, boolean> }
): { trusted: boolean; persisted: boolean } {
  const store = new ProjectTrustStore(agentDir);
  const parentPath = getTrustParentPath(cwd);

  switch (optionId) {
    case "trust":
      store.set(cwd, true);
      return { trusted: true, persisted: true };
    case "trust-parent":
      if (parentPath) store.setMany([{ path: parentPath, decision: true }, { path: cwd, decision: null }]);
      else store.set(cwd, true);
      return { trusted: true, persisted: true };
    case "trust-session":
      options?.sessionOnlyTrust?.set(cwd, true);  // 仅写内存 Map
      return { trusted: true, persisted: false };
    case "deny":
      store.set(cwd, false);
      return { trusted: false, persisted: true };
    case "deny-session":
      options?.sessionOnlyTrust?.set(cwd, false);
      return { trusted: false, persisted: false };
  }
}
```

**父目录信任** 机制：`trust-parent` 将父目录标记为 `true`，当前目录标记为 `null`。后续 `evaluateProjectTrust` 读取到 `null` 时会继续向上查找父目录决策（由 `ProjectTrustStore` 内部实现）。

---

## 前端自动重试：`ensureTrustThenFetch`

`lib/trust-fetch.ts` 提供 **通用重试封装**，任何可能返回 409 的 API 调用都应通过它发起。

```typescript
// lib/trust-fetch.ts#L7-L40
export async function ensureTrustThenFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  promptTrust: (payload: NeedsTrustPayload) => Promise<string | null>
): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(input, init);
    if (res.status !== 409) return res;

    const body: NeedsTrustPayload = await res.json();
    if (!body?.needsTrust || !body.cwd) return res;

    const optionId = await promptTrust(body);  // 弹窗等待用户选择
    if (!optionId) return new Response(..., { status: 499 });  // 用户取消

    const trustRes = await fetch("/api/trust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: body.cwd, optionId }),
    });
    if (!trustRes.ok) return trustRes;
  }
  return fetch(input, init);  // 最多 4 次尝试后放弃重试
}
```

**调用点**：`useSessionCommands.handleSend` → `commandTarget.kind === "new"` 分支。

```typescript
// hooks/agent-session/use-session-commands.ts#L180-L210
const res = await ensureTrustThenFetch(
  "/api/agent/new",
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({...}) },
  promptTrust  // 来自 useAgentSession 的 promptTrust 回调
);
```

**`promptTrust` 实现**（`useAgentSession.ts`）：

```typescript
// hooks/useAgentSession.ts#L280-L290
const promptTrust = useCallback((payload: NeedsTrustPayload) => {
  return new Promise<string | null>((resolve) => {
    trustResolverRef.current = resolve;
    setTrustPrompt(payload);  // 触发 ProjectTrustDialog 显示
  });
}, []);
```

用户在 `ProjectTrustDialog` 点击按钮 → 调用 `resolveTrustPrompt(optionId)` → `Promise` resolve → `ensureTrustThenFetch` 继续重试原请求。

---

## UI 组件：`ProjectTrustDialog`

`components/ProjectTrustDialog.tsx` 是**纯展示组件**，接收 `NeedsTrustPayload` 渲染选项按钮，通过 `onChoose(optionId)` 回调将选择传回。

```mermaid
sequenceDiagram
    participant User
    participant Dialog as ProjectTrustDialog
    participant Hook as useAgentSession
    participant Fetch as ensureTrustThenFetch
    participant API as /api/trust + /api/agent/new

    User->>Dialog: 点击 "Trust (this session only)"
    Dialog->>Hook: onChoose("trust-session")
    Hook->>Hook: resolveTrustPrompt("trust-session")
    Hook->>Fetch: Promise resolve
    Fetch->>API: POST /api/trust {cwd, optionId}
    API-->>Fetch: 200 OK
    Fetch->>API: 重试 POST /api/agent/new
    API-->>Fetch: 200 {sessionId}
    Fetch-->>Hook: 返回 Response
    Hook->>Hook: sessionIdRef.current = realId; connectEvents()
```

**关键 Props**：

```typescript
// components/ProjectTrustDialog.tsx#L10-L18
interface Props {
  payload: NeedsTrustPayload | null;
  onChoose: (optionId: string) => void;
  onCancel?: () => void;
}
```

**国际化文案** 通过 `useI18n` 注入，支持多语言。

---

## API 路由协作

| 路由 | 方法 | 职责 | 关键逻辑 |
|------|------|------|----------|
| `/api/agent/new` | POST | 创建新会话并发送首条消息 | 调用 `evaluateProjectTrust`，若 `prompt` 返回 409 |
| `/api/trust` | POST | 接收用户决策，持久化或写内存 | `applyTrustDecision`，返回 `{trusted, persisted}` |
| `/api/trust` | GET | 查询当前目录信任状态 | `evaluateProjectTrust`，供调试/预检 |

**`/api/agent/new` 信任检查节点**：

```typescript
// app/api/agent/new/route.ts#L35-L44
const trustGate = evaluateProjectTrust(cwd, { sessionOnlyTrust: getSessionOnlyTrustMap() });
if (trustGate.action === "prompt") {
  return NextResponse.json(trustGate.payload, { status: 409, headers: { "x-request-id": requestId } });
}
```

**`/api/trust` POST 处理**：

```typescript
// app/api/trust/route.ts#L14-L32
const sessionOnly = getSessionOnlyTrustMap();
const result = applyTrustDecision(body.cwd, body.optionId as TrustOptionId, { sessionOnlyTrust: sessionOnly });
return NextResponse.json({ success: true, trusted: result.trusted, persisted: result.persisted });
```

---

## 会话级临时信任：内存 Map 设计

**`sessionOnlyTrust: Map<string, boolean>`** 存储在 `globalThis.__piSessionOnlyTrust`，由 `lib/rpc-manager.ts` 导出 `getSessionOnlyTrustMap()` 访问。

```typescript
// lib/rpc-manager.ts#L710-L715
declare global {
  var __piSessionOnlyTrust: Map<string, boolean> | undefined;
}
export function getSessionOnlyTrustMap(): Map<string, boolean> {
  if (!globalThis.__piSessionOnlyTrust) globalThis.__piSessionOnlyTrust = new Map();
  return globalThis.__piSessionOnlyTrust;
}
```

**特性**：
- **进程级单例**：Next.js 服务是 Electron spawn 的独立子进程（dev 与生产模式均是），该 Map 挂在 Next 服务子进程的 `globalThis` 上，随该子进程生命周期共享，不在 Electron 主进程内
- **不落盘**：重启应用后自动清空
- **键为 `cwd`**：同一项目在同一进程内多次新建会话复用决策
- **优先级高于持久化**：`evaluateProjectTrust` 先查内存 Map 再查磁盘

**使用场景**：用户选择 "Trust (this session only)" 或 "Do not trust (this session only)"，适合临时探索不熟悉项目。

---

## 延迟 Session 创建的完整时序

```mermaid
sequenceDiagram
    autonumber
    participant U as 用户
    participant CS as ChatWindow / useSessionCommands
    participant AT as ensureTrustThenFetch
    participant API_NEW as POST /api/agent/new
    participant API_TRUST as POST /api/trust
    participant Trust as evaluateProjectTrust / applyTrustDecision
    participant RPC as startRpcSession

    U->>CS: 输入消息，点击发送
    CS->>CS: 创建乐观 user message, setAgentRunning(true)
    CS->>AT: ensureTrustThenFetch("/api/agent/new", {...}, promptTrust)
    AT->>API_NEW: POST {cwd, message, toolNames, agentMode...}
    API_NEW->>Trust: evaluateProjectTrust(cwd)
    alt 无需信任资源或已有决策
        Trust-->>API_NEW: {action: "proceed", trusted: true}
        API_NEW->>RPC: startRpcSession(tempKey, "", cwd, opts)
        RPC-->>API_NEW: {session, realSessionId}
        API_NEW->>API_NEW: session.send(promptCommand)
        API_NEW-->>AT: 200 {sessionId, data}
    else 需信任且无决策
        Trust-->>API_NEW: {action: "prompt", payload: NeedsTrustPayload}
        API_NEW-->>AT: 409 NeedsTrustPayload
        AT->>CS: promptTrust(payload) → 显示 ProjectTrustDialog
        U->>CS: 选择 "Trust (this session only)"
        CS->>AT: resolveTrustPrompt("trust-session")
        AT->>API_TRUST: POST {cwd, optionId: "trust-session"}
        API_TRUST->>Trust: applyTrustDecision(..., "trust-session")
        Trust-->>API_TRUST: {trusted: true, persisted: false}
        API_TRUST-->>AT: 200 OK
        AT->>API_NEW: 重试原请求 (第 2 次 attempt)
        API_NEW->>Trust: evaluateProjectTrust(cwd) → 读内存 Map → proceed
        API_NEW->>RPC: 创建真实 Session
        API_NEW-->>AT: 200 {sessionId}
    end
    AT-->>CS: Response.ok
    CS->>CS: sessionIdRef.current = realId; connectEvents(realId)
    CS->>CS: onSessionCreated({id: realId, cwd...})
```

**关键点**：
1. **乐观 UI**：用户消息立即渲染（`deliveryState: "pending"`），等待服务端确认后替换为规范条目
2. **临时 Key**：`startRpcSession` 接收 `__new__${timestamp}__${random}` 避免与真实 sessionId 冲突
3. **SSE 连接建立**：拿到 `realSessionId` 后立即 `connectEvents()` 订阅流式事件
4. **父组件回调**：`onSessionCreated` 通知 `AppShell` 更新 URL `/ ?session=...` 并刷新侧边栏

---

## 信任状态的跨组件同步

| 组件/Hook | 读取信任状态 | 修改信任状态 |
|-----------|--------------|--------------|
| `useAgentSession` | `trustPrompt` state (显示弹窗) | `setTrustPrompt`, `resolveTrustPrompt` |
| `useSessionCommands` | `promptTrust` 回调 | 调用 `promptTrust` 触发弹窗 |
| `ProjectTrustDialog` | `payload` prop | `onChoose(optionId)` |
| `/api/trust` GET | `evaluateProjectTrust` | — |
| `/api/trust` POST | — | `applyTrustDecision` |
| `ProjectTrustStore` | `store.get(cwd)` | `store.set(cwd, bool)` |
| `sessionOnlyTrust Map` | `map.has(cwd)` | `map.set(cwd, bool)` |

**数据流向单向**：用户交互 → `applyTrustDecision` → 存储 → 后续 `evaluateProjectTrust` 读取 → 前端重试成功。

---

## 常见问题与排查

| 现象 | 可能原因 | 排查步骤 |
|------|----------|----------|
| 首条消息发送后长时间无响应 | `ensureTrustThenFetch` 重试循环卡住 | 检查 Network 面板：是否有 409 → `/api/trust` 200 → 重试 200 的完整链路 |
| 选择 "Trust" 但下次打开仍弹窗 | `ProjectTrustStore` 写入失败或路径不匹配 | 检查 `~/.pi/agent/trust.json` 是否包含该 `cwd`；路径大小写/分隔符是否一致 |
| 选择 "Trust (session only)" 重启后仍生效 | 误用了持久化选项 | 确认 `persist: false` 选项仅写入内存 Map；重启后 Map 为空 |
| 父目录信任不生效 | `trust-parent` 逻辑路径计算错误 | 验证 `getTrustParentPath(cwd)` 返回正确父路径；`store.setMany` 是否同时写入父目录 `true` 和当前目录 `null` |
| 409 后用户点取消，前端报错 | `promptTrust` 返回 `null` → `ensureTrustThenFetch` 返回 499 | 检查 `onCancel` 回调是否正确调用 `resolveTrustPrompt(null)` |

---

## 相关文件速查

| 文件 | 角色 | 关键导出 |
|------|------|----------|
| `lib/project-trust-desktop.ts` | 核心决策逻辑 | `evaluateProjectTrust`, `applyTrustDecision`, `buildTrustOptions` |
| `lib/trust-types.ts` | 共享 DTO 类型 | `TrustOptionId`, `TrustOptionDto`, `NeedsTrustPayload` |
| `lib/trust-fetch.ts` | 前端重试封装 | `ensureTrustThenFetch` |
| `app/api/agent/new/route.ts` | 会话创建入口 | `POST` 调用 `evaluateProjectTrust` 返回 409 |
| `app/api/trust/route.ts` | 信任决策持久化 | `POST` 调用 `applyTrustDecision` |
| `hooks/useAgentSession.ts` | 会话级状态管理 | `promptTrust`, `resolveTrustPrompt`, `trustPrompt` state |
| `hooks/agent-session/use-session-commands.ts` | 发送命令编排 | `handleSend` 调用 `ensureTrustThenFetch` |
| `components/ProjectTrustDialog.tsx` | 信任选择 UI | `ProjectTrustDialog` |
| `lib/rpc-manager.ts` | 会话级内存存储 | `getSessionOnlyTrustMap` |

---

## 后续阅读建议

- **上游依赖**：`@earendil-works/pi-coding-agent` 的 `hasTrustRequiringProjectResources` 与 `ProjectTrustStore` 实现
- **会话创建全流程**：[SSE 事件流与流式状态机](8-sse-shi-jian-liu-yu-liu-shi-zhuang-tai-ji) → `startRpcSession` 与 `AgentSessionWrapper`
- **前端状态机**：[streamReducer 流式消息状态机与增量渲染](23-streamreducer-liu-shi-xiao-xi-zhuang-tai-ji-yu-zeng-liang-xuan-ran) → 乐观消息如何被规范条目替换
- **Agent 模式与工具预设**：[Agent 模式与 Ask 拦截：Plan / Ask / Full](16-agent-mo-shi-yu-ask-lan-jie-plan-ask-full) → `agentMode` 与 `toolPreset` 如何影响首条消息发送参数