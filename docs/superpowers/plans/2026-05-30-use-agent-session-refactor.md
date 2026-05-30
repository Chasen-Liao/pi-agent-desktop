# useAgentSession 状态与副作用拆分实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标:** 在不改变现有用户行为的前提下，把 `hooks/useAgentSession.ts` 中的 session 读取、Agent 事件运行态、滚动副作用和统计计算拆成更清晰的小单元。

**架构:** 第一阶段只做低风险提取：把纯计算和独立副作用移出大 hook，并用 Node 内置测试覆盖纯函数。第二阶段再把 session 读取和 SSE 运行态提取成专用 hook，但仍由 `useAgentSession` 作为对外兼容门面，避免一次性修改 `ChatWindow` 的调用契约。

**技术栈:** Next.js App Router、React 19、TypeScript、Node 内置 test runner、现有 `fetch` API、现有 Pi session / Agent API。

---

## 文件结构

本计划只围绕 `useAgentSession.ts` 进行渐进式拆分，不同时重构 `AppShell.tsx`、`rpc-manager.ts` 或 API route。

- 新建：`hooks/agent-session/session-stats.ts`
  - 负责从 `AgentMessage[]` 计算 token 与 cost 汇总。
  - 纯函数，可直接用 Node test 覆盖。

- 新建：`hooks/agent-session/session-stats.test.ts`
  - 覆盖空消息、无 usage 消息、多条 assistant usage 聚合。

- 新建：`hooks/agent-session/stream-state.ts`
  - 负责 `StreamingState`、`StreamAction` 和 `streamReducer`。
  - 从 `useAgentSession.ts` 移出纯 reducer。

- 新建：`hooks/agent-session/stream-state.test.ts`
  - 覆盖 start、update、end、reset 四种 action。

- 新建：`hooks/agent-session/agent-phase.ts`
  - 负责 `AgentPhase` 类型和从 tool start/end event 推导 phase 的纯函数。

- 新建：`hooks/agent-session/agent-phase.test.ts`
  - 覆盖工具开始、重复工具开始、工具结束、最后一个工具结束。

- 新建：`hooks/agent-session/use-chat-scroll.ts`
  - 负责 `messagesEndRef`、`scrollContainerRef`、`lastUserMsgRef`、`pendingScrollToUserRef`、`initialScrollDoneRef` 和滚动 effect。
  - 这是 React hook，不写 Node 单测；通过类型检查和手动 UI 验证。

- 新建：`hooks/agent-session/use-session-loader.ts`
  - 负责 `loadSession`、`loadContext` 以及对应的 `data/messages/entryIds/activeLeafId/loading/error` 状态。
  - 初次提取时保持函数行为和错误处理不变。

- 新建：`hooks/agent-session/use-agent-events.ts`
  - 负责 `EventSource` 连接、断线重连、`handleAgentEventRef` 和基础 event 分发。
  - 初次提取时不改变事件语义。

- 修改：`hooks/useAgentSession.ts`
  - 继续作为 `ChatWindow` 的唯一调用入口。
  - 删除已经迁移出去的 reducer、统计、滚动和 loader 实现。
  - 对外返回字段名保持不变。

- 不修改：`components/ChatWindow.tsx`
  - 本轮不改调用契约，降低风险。

---

### Task 1: 提取并测试 session 统计计算

**Files:**
- Create: `hooks/agent-session/session-stats.ts`
- Create: `hooks/agent-session/session-stats.test.ts`
- Modify: `hooks/useAgentSession.ts`

- [ ] **Step 1: 写失败测试**

创建 `hooks/agent-session/session-stats.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "../../lib/types.ts";
import { calculateSessionStats } from "./session-stats.ts";

test("returns null when there are no usage values", () => {
  const messages: AgentMessage[] = [
    { role: "user", content: "hello" },
    {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      model: "claude",
      provider: "anthropic",
    },
  ];

  assert.equal(calculateSessionStats(messages), null);
});

test("sums assistant usage and cost", () => {
  const messages: AgentMessage[] = [
    { role: "user", content: "hello" },
    {
      role: "assistant",
      content: [{ type: "text", text: "first" }],
      model: "claude",
      provider: "anthropic",
      usage: {
        input: 10,
        output: 20,
        cacheRead: 30,
        cacheWrite: 40,
        cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
      },
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "second" }],
      model: "claude",
      provider: "anthropic",
      usage: {
        input: 1,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
        cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
      },
    },
  ];

  assert.deepEqual(calculateSessionStats(messages), {
    tokens: { input: 11, output: 22, cacheRead: 33, cacheWrite: 44 },
    cost: 11,
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types hooks/agent-session/session-stats.test.ts`

Expected: FAIL，错误包含 `Cannot find module` 或 `does not provide an export named 'calculateSessionStats'`。

- [ ] **Step 3: 实现纯函数**

创建 `hooks/agent-session/session-stats.ts`：

```ts
import type { AgentMessage, AssistantMessage } from "@/lib/types";

export interface SessionStats {
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  cost?: number;
}

export function calculateSessionStats(messages: AgentMessage[]): SessionStats | null {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost = 0;

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const usage = (msg as AssistantMessage).usage;
    if (!usage) continue;
    tokens.input += usage.input ?? 0;
    tokens.output += usage.output ?? 0;
    tokens.cacheRead += usage.cacheRead ?? 0;
    tokens.cacheWrite += usage.cacheWrite ?? 0;
    cost += usage.cost?.total ?? 0;
  }

  const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return total > 0 ? { tokens, cost } : null;
}
```

- [ ] **Step 4: 让测试导入路径适配 Node test**

如果 `node --test --experimental-strip-types` 不能解析 `@/lib/types`，把 `session-stats.ts` 的导入改成相对路径：

```ts
import type { AgentMessage, AssistantMessage } from "../../lib/types";
```

Expected: 只允许为了 Node test 解析 TypeScript 路径而改 import，不改函数行为。

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test --experimental-strip-types hooks/agent-session/session-stats.test.ts`

Expected: PASS，输出包含 `# pass 2`。

- [ ] **Step 6: 替换 `useAgentSession.ts` 内联统计逻辑**

在 `hooks/useAgentSession.ts` 顶部增加：

```ts
import { calculateSessionStats } from "./agent-session/session-stats";
```

把当前的内联 `sessionStats` 计算替换为：

```ts
const sessionStats = calculateSessionStats(messages);
```

- [ ] **Step 7: 验证类型和现有测试**

Run: `npx tsc --noEmit`

Expected: PASS。

Run: `node --test --experimental-strip-types hooks/agent-session/session-stats.test.ts`

Expected: PASS。

---

### Task 2: 提取并测试 streaming reducer

**Files:**
- Create: `hooks/agent-session/stream-state.ts`
- Create: `hooks/agent-session/stream-state.test.ts`
- Modify: `hooks/useAgentSession.ts`

- [ ] **Step 1: 写失败测试**

创建 `hooks/agent-session/stream-state.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { streamReducer, initialStreamingState } from "./stream-state.ts";

test("start marks streaming without a message", () => {
  assert.deepEqual(streamReducer(initialStreamingState, { type: "start" }), {
    isStreaming: true,
    streamingMessage: null,
  });
});

test("update stores partial streaming message", () => {
  const message = { role: "assistant" as const };
  assert.deepEqual(streamReducer(initialStreamingState, { type: "update", message }), {
    isStreaming: true,
    streamingMessage: message,
  });
});

test("end clears streaming state", () => {
  const state = { isStreaming: true, streamingMessage: { role: "assistant" as const } };
  assert.deepEqual(streamReducer(state, { type: "end" }), initialStreamingState);
});

test("reset clears streaming state", () => {
  const state = { isStreaming: true, streamingMessage: { role: "assistant" as const } };
  assert.deepEqual(streamReducer(state, { type: "reset" }), initialStreamingState);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types hooks/agent-session/stream-state.test.ts`

Expected: FAIL，错误包含 `Cannot find module` 或缺少 `streamReducer` 导出。

- [ ] **Step 3: 实现 reducer**

创建 `hooks/agent-session/stream-state.ts`：

```ts
import type { AgentMessage } from "../../lib/types";

export interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

export type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "end" }
  | { type: "reset" };

export const initialStreamingState: StreamingState = {
  isStreaming: false,
  streamingMessage: null,
};

export function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingMessage: null };
    case "update":
      return { isStreaming: true, streamingMessage: action.message };
    case "end":
    case "reset":
      return initialStreamingState;
    default:
      return state;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --experimental-strip-types hooks/agent-session/stream-state.test.ts`

Expected: PASS，输出包含 `# pass 4`。

- [ ] **Step 5: 替换 `useAgentSession.ts` 内联 reducer**

在 `hooks/useAgentSession.ts` 顶部增加：

```ts
import { initialStreamingState, streamReducer } from "./agent-session/stream-state";
```

删除 `StreamingState`、`StreamAction` 和本地 `streamReducer` 定义。

把：

```ts
const [streamState, dispatch] = useReducer(streamReducer, { isStreaming: false, streamingMessage: null });
```

替换为：

```ts
const [streamState, dispatch] = useReducer(streamReducer, initialStreamingState);
```

- [ ] **Step 6: 验证类型和测试**

Run: `node --test --experimental-strip-types hooks/agent-session/stream-state.test.ts`

Expected: PASS。

Run: `npx tsc --noEmit`

Expected: PASS。

---

### Task 3: 提取并测试 Agent phase 纯逻辑

**Files:**
- Create: `hooks/agent-session/agent-phase.ts`
- Create: `hooks/agent-session/agent-phase.test.ts`
- Modify: `hooks/useAgentSession.ts`
- Modify: `components/ChatWindow.tsx`

- [ ] **Step 1: 写失败测试**

创建 `hooks/agent-session/agent-phase.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { addRunningTool, removeRunningTool } from "./agent-phase.ts";

test("addRunningTool starts running_tools phase", () => {
  assert.deepEqual(addRunningTool(null, "tool-1", "read"), {
    kind: "running_tools",
    tools: [{ id: "tool-1", name: "read" }],
  });
});

test("addRunningTool does not duplicate an existing tool", () => {
  const phase = { kind: "running_tools" as const, tools: [{ id: "tool-1", name: "read" }] };
  assert.deepEqual(addRunningTool(phase, "tool-1", "read"), phase);
});

test("removeRunningTool keeps remaining tools", () => {
  const phase = {
    kind: "running_tools" as const,
    tools: [
      { id: "tool-1", name: "read" },
      { id: "tool-2", name: "bash" },
    ],
  };

  assert.deepEqual(removeRunningTool(phase, "tool-1"), {
    kind: "running_tools",
    tools: [{ id: "tool-2", name: "bash" }],
  });
});

test("removeRunningTool returns waiting_model after the last tool ends", () => {
  const phase = { kind: "running_tools" as const, tools: [{ id: "tool-1", name: "read" }] };
  assert.deepEqual(removeRunningTool(phase, "tool-1"), { kind: "waiting_model" });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types hooks/agent-session/agent-phase.test.ts`

Expected: FAIL，错误包含 `Cannot find module` 或缺少 `addRunningTool` 导出。

- [ ] **Step 3: 实现 phase helper**

创建 `hooks/agent-session/agent-phase.ts`：

```ts
export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_tools"; tools: { id: string; name: string }[] }
  | null;

export function addRunningTool(phase: AgentPhase, id: string, name: string): AgentPhase {
  const tools = phase?.kind === "running_tools" ? [...phase.tools] : [];
  if (!tools.some((tool) => tool.id === id)) tools.push({ id, name });
  return { kind: "running_tools", tools };
}

export function removeRunningTool(phase: AgentPhase, id: string): AgentPhase {
  if (phase?.kind !== "running_tools") return phase;
  const tools = phase.tools.filter((tool) => tool.id !== id);
  if (tools.length === 0) return { kind: "waiting_model" };
  return { kind: "running_tools", tools };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --experimental-strip-types hooks/agent-session/agent-phase.test.ts`

Expected: PASS，输出包含 `# pass 4`。

- [ ] **Step 5: 替换 `useAgentSession.ts` 中的 AgentPhase 定义和工具 phase 逻辑**

在 `hooks/useAgentSession.ts` 顶部增加：

```ts
import { addRunningTool, removeRunningTool, type AgentPhase } from "./agent-session/agent-phase";
```

删除本地 `AgentPhase` 类型定义。

把 `tool_execution_start` 分支中的 `setAgentPhase` 替换为：

```ts
setAgentPhase((prev) => addRunningTool(prev, id, name));
```

把 `tool_execution_end` 分支中的 `setAgentPhase` 替换为：

```ts
setAgentPhase((prev) => removeRunningTool(prev, id));
```

- [ ] **Step 6: 修正 `ChatWindow.tsx` 的类型导入**

把 `components/ChatWindow.tsx` 中：

```ts
import { useAgentSession, type AgentPhase } from "@/hooks/useAgentSession";
```

改为：

```ts
import { useAgentSession } from "@/hooks/useAgentSession";
import type { AgentPhase } from "@/hooks/agent-session/agent-phase";
```

- [ ] **Step 7: 验证类型和测试**

Run: `node --test --experimental-strip-types hooks/agent-session/agent-phase.test.ts`

Expected: PASS。

Run: `npx tsc --noEmit`

Expected: PASS。

---

### Task 4: 提取聊天滚动副作用

**Files:**
- Create: `hooks/agent-session/use-chat-scroll.ts`
- Modify: `hooks/useAgentSession.ts`

- [ ] **Step 1: 创建滚动 hook**

创建 `hooks/agent-session/use-chat-scroll.ts`：

```ts
"use client";

import { useCallback, useEffect, useRef } from "react";

interface UseChatScrollOptions {
  messageCount: number;
  agentRunning: boolean;
}

export function useChatScroll({ messageCount, agentRunning }: UseChatScrollOptions) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const agentRunningRef = useRef(false);

  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const scrollUserMsgToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const el = lastUserMsgRef.current;
    if (!container || !el) return;
    const elAbsTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: elAbsTop - 16, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (messageCount <= 0) return;
    if (pendingScrollToUserRef.current) {
      pendingScrollToUserRef.current = false;
      initialScrollDoneRef.current = true;
      scrollUserMsgToTop();
    } else if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      scrollToBottom("instant");
    } else if (!agentRunningRef.current) {
      scrollToBottom("smooth");
    }
  }, [messageCount, agentRunning, scrollToBottom, scrollUserMsgToTop]);

  return {
    messagesEndRef,
    scrollContainerRef,
    lastUserMsgRef,
    pendingScrollToUserRef,
    initialScrollDoneRef,
  };
}
```

- [ ] **Step 2: 在 `useAgentSession.ts` 中使用滚动 hook**

在顶部增加：

```ts
import { useChatScroll } from "./agent-session/use-chat-scroll";
```

删除这些本地 ref：

```ts
const initialScrollDoneRef = useRef(false);
const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
const pendingScrollToUserRef = useRef(false);
const messagesEndRef = useRef<HTMLDivElement | null>(null);
const scrollContainerRef = useRef<HTMLDivElement | null>(null);
```

在 `agentRunning` state 定义之后增加：

```ts
const {
  messagesEndRef,
  scrollContainerRef,
  lastUserMsgRef,
  pendingScrollToUserRef,
  initialScrollDoneRef,
} = useChatScroll({ messageCount: messages.length, agentRunning });
```

- [ ] **Step 3: 删除 `useAgentSession.ts` 内联滚动函数和 effect**

删除：

```ts
const scrollToBottom = useCallback(...);
const scrollUserMsgToTop = useCallback(...);
useEffect(() => {
  if (messages.length > 0) {
    ...
  }
}, [messages.length, agentRunning, scrollToBottom, scrollUserMsgToTop]);
```

Expected: `pendingScrollToUserRef.current = true` 的发送消息逻辑保持不变。

- [ ] **Step 4: 验证类型**

Run: `npx tsc --noEmit`

Expected: PASS。

---

### Task 5: 提取 session 读取 hook

**Files:**
- Create: `hooks/agent-session/use-session-loader.ts`
- Modify: `hooks/useAgentSession.ts`

- [ ] **Step 1: 创建 session loader hook**

创建 `hooks/agent-session/use-session-loader.ts`：

```ts
"use client";

import { useCallback, useState } from "react";
import type { AgentMessage, SessionInfo, SessionTreeNode } from "../../lib/types";

export interface SessionData {
  sessionId: string;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

export interface LoadedAgentState {
  running: boolean;
  state?: {
    isStreaming?: boolean;
    isCompacting?: boolean;
    contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
    systemPrompt?: string;
    thinkingLevel?: string;
  };
}

export function useSessionLoader(session: SessionInfo | null, isNew: boolean) {
  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false) => {
    try {
      if (showLoading) setLoading(true);
      const url = includeState
        ? `/api/sessions/${encodeURIComponent(sid)}?includeState`
        : `/api/sessions/${encodeURIComponent(sid)}`;
      const res = await fetch(url);
      if (res.status === 404) {
        if (showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setError(null);
        }
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as SessionData & { agentState?: LoadedAgentState };
      setData(d);
      setActiveLeafId(d.leafId);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setError(null);
      return d.agentState ?? null;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const loadContext = useCallback(async (sid: string, leafId: string | null) => {
    try {
      const url = leafId
        ? `/api/sessions/${encodeURIComponent(sid)}/context?leafId=${encodeURIComponent(leafId)}`
        : `/api/sessions/${encodeURIComponent(sid)}/context`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { context: { messages: AgentMessage[]; entryIds: string[] } };
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
    } catch (e) {
      console.error("Failed to load context:", e);
    }
  }, []);

  return {
    data,
    setData,
    loading,
    error,
    activeLeafId,
    setActiveLeafId,
    messages,
    setMessages,
    entryIds,
    setEntryIds,
    loadSession,
    loadContext,
  };
}
```

- [ ] **Step 2: 在 `useAgentSession.ts` 中使用 loader hook**

顶部增加：

```ts
import { useSessionLoader } from "./agent-session/use-session-loader";
import type { SessionData } from "./agent-session/use-session-loader";
```

删除本地 `SessionData` interface。

删除这些本地 state：

```ts
const [data, setData] = useState<SessionData | null>(null);
const [loading, setLoading] = useState(!isNew);
const [error, setError] = useState<string | null>(null);
const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
const [messages, setMessages] = useState<AgentMessage[]>([]);
const [entryIds, setEntryIds] = useState<string[]>([]);
```

在 `isNew` 定义后增加：

```ts
const {
  data,
  setData,
  loading,
  error,
  activeLeafId,
  setActiveLeafId,
  messages,
  setMessages,
  entryIds,
  loadSession,
  loadContext,
} = useSessionLoader(session, isNew);
```

- [ ] **Step 3: 删除 `useAgentSession.ts` 内联 `loadSession` 和 `loadContext`**

删除原来的：

```ts
const loadSession = useCallback(...);
const loadContext = useCallback(...);
```

- [ ] **Step 4: 保留 thinking level fallback 行为**

原来 `loadSession` 内有：

```ts
if (!d.agentState?.state?.thinkingLevel && d.context.thinkingLevel && d.context.thinkingLevel !== "off") {
  setThinkingLevel(d.context.thinkingLevel as ThinkingLevelOption);
}
```

提取后，在初次加载 session 的 effect 中，在 `loadSession(session.id, true, true).then((agentState) => { ... })` 后补一次基于 `data` 不可行，因为 `setData` 异步。改为让 `useSessionLoader.loadSession` 返回 context thinking level：

把 `LoadedAgentState` 返回类型改成：

```ts
return { agentState: d.agentState ?? null, contextThinkingLevel: d.context.thinkingLevel };
```

然后在 `useAgentSession.ts` 中处理：

```ts
loadSession(session.id, true, true).then((loaded) => {
  const agentState = loaded?.agentState ?? null;
  if (!agentState?.state?.thinkingLevel && loaded?.contextThinkingLevel && loaded.contextThinkingLevel !== "off") {
    setThinkingLevel(loaded.contextThinkingLevel as ThinkingLevelOption);
  }
  ...
});
```

Expected: 行为与原来一致。

- [ ] **Step 5: 验证类型**

Run: `npx tsc --noEmit`

Expected: PASS。

---

### Task 6: 提取 Agent EventSource 连接 hook

**Files:**
- Create: `hooks/agent-session/use-agent-events.ts`
- Modify: `hooks/useAgentSession.ts`

- [ ] **Step 1: 创建 events hook**

创建 `hooks/agent-session/use-agent-events.ts`：

```ts
"use client";

import { useCallback, useEffect, useRef } from "react";

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

interface UseAgentEventsOptions {
  agentRunning: boolean;
}

export function useAgentEvents({ agentRunning }: UseAgentEventsOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const agentRunningRef = useRef(false);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);

  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);

  const connectEvents = useCallback((sid: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    const es = new EventSource(`/api/agent/${encodeURIComponent(sid)}/events`);
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as AgentEvent;
        handleAgentEventRef.current?.(event);
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      if (eventSourceRef.current === es && agentRunningRef.current) {
        es.close();
        eventSourceRef.current = null;
        setTimeout(() => {
          if (agentRunningRef.current) connectEvents(sid);
        }, 1000);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, []);

  return {
    eventSourceRef,
    agentRunningRef,
    handleAgentEventRef,
    connectEvents,
  };
}
```

- [ ] **Step 2: 在 `useAgentSession.ts` 中使用 events hook**

顶部增加：

```ts
import { useAgentEvents, type AgentEvent } from "./agent-session/use-agent-events";
```

删除本地 `AgentEvent` interface。

删除这些本地 ref：

```ts
const eventSourceRef = useRef<EventSource | null>(null);
const agentRunningRef = useRef(false);
const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);
```

删除同步 `agentRunningRef` 的 effect：

```ts
useEffect(() => {
  agentRunningRef.current = agentRunning;
}, [agentRunning]);
```

删除本地 `connectEvents` 定义。

在 `agentRunning` state 定义之后增加：

```ts
const {
  eventSourceRef,
  agentRunningRef,
  handleAgentEventRef,
  connectEvents,
} = useAgentEvents({ agentRunning });
```

- [ ] **Step 3: 删除 `useAgentSession.ts` 初次加载 effect 中的 cleanup**

原来的初次加载 effect 返回：

```ts
return () => {
  eventSourceRef.current?.close();
  eventSourceRef.current = null;
};
```

删除这个 return，因为 cleanup 已经在 `useAgentEvents` 中处理。

- [ ] **Step 4: 验证类型**

Run: `npx tsc --noEmit`

Expected: PASS。

---

### Task 7: 统一验证拆分后行为

**Files:**
- Modify only if previous tasks reveal type or behavior regressions.

- [ ] **Step 1: 运行所有新增 Node 测试**

Run: `node --test --experimental-strip-types hooks/agent-session/*.test.ts`

Expected: PASS。

- [ ] **Step 2: 运行现有 Node 测试**

Run: `node --test --experimental-strip-types lib/custom-path-selection.test.ts lib/slash-commands.test.ts`

Expected: PASS。

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit`

Expected: PASS。

- [ ] **Step 4: 运行 lint**

Run: `npm run lint`

Expected: PASS。

- [ ] **Step 5: 启动浏览器开发模式**

Run: `npm run dev`

Expected: Next.js dev server 在 `http://localhost:30141` 启动成功。

- [ ] **Step 6: 手动验证核心路径**

在浏览器中验证：

1. 打开已有 session，消息能正常加载。
2. 新建 session，发送第一条消息，session id 能真实生成。
3. 发送后 assistant streaming 能显示。
4. agent 结束后消息不会重复。
5. branch navigator 能切换 leaf。
6. fork 一个历史消息后 sidebar 能刷新。
7. compact 按钮行为与重构前一致。
8. 模型切换、thinking level、tool preset 仍能正常显示和发送。
9. 打开文件 tab，文件面板行为不受影响。

Expected: 所有路径行为与重构前一致。

- [ ] **Step 7: 如果需要验证 Electron 开发模式**

Run: `npm run dev:electron`

Expected: Electron 窗口启动成功，并能完成 Step 6 中的新建 session、发送消息、打开文件三个核心动作。

---

## 自检结果

1. **需求覆盖:** 本计划覆盖优先级最高的 `useAgentSession.ts` 拆分，不包含 `AppShell.tsx`、`rpc-manager.ts`、API 语义和 Electron 主进程模块化；这些应作为后续独立计划处理。
2. **占位符扫描:** 没有使用 TBD、TODO、implement later、similar to 等占位写法。每个新增文件都有明确代码或明确验证命令。
3. **类型一致性:** `AgentPhase` 从 `useAgentSession.ts` 移到 `hooks/agent-session/agent-phase.ts` 后，`ChatWindow.tsx` 的类型导入需要同步修改。`SessionData` 从 loader hook 导出，`useAgentSession.ts` 继续作为对外门面。

## 执行建议

推荐按 Task 1 到 Task 7 顺序执行。Task 1-3 是纯函数提取，风险最低；Task 4-6 是 hook 提取，每完成一个都运行 `npx tsc --noEmit`；Task 7 必须做手动 UI 验证后才能认为完成。
