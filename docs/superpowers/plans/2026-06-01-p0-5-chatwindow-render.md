# P0-5 ChatWindow 渲染性能优化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 ChatWindow 流式期的 O(n²) forward scan，并让 MessageView 在 ChatWindow 任意非消息相关的 state 变化时跳过 re-render。

**Architecture:** 抽 `components/MessageList.tsx` 子组件；ChatWindow 用 `useMemo` 预计算 `toolResultsMap` / `nextUserIdx` / `nextAssistantIdx` / `lastUserIdx`；顶层 `MessageView` export 包 `React.memo`；条件 `onFork`/`onNavigate` 保持引用稳定；stable key 用 `entryIds[idx]`。

**Tech Stack:** React 19、TypeScript 5 (strict)、Next.js 16、`node --test`（无 React testing infra，无新增自动化测试）。无新依赖。

**Spec:** `docs/superpowers/specs/2026-06-01-p0-5-chatwindow-render-design.md`

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `components/MessageView.tsx` | 修改 | 顶层 export 包 `React.memo`（~3 行） |
| `components/MessageList.tsx` | 新建 | 消息列表子组件，包 `React.memo`（~110 行） |
| `components/ChatWindow.tsx` | 修改 | useMemo + useCallback + 替换 IIFE（~10 行改动） |

---

## Task 1: MessageView 包 `React.memo`

**Files:**
- Modify: `components/MessageView.tsx` (line 68 export 签名)

- [ ] **Step 1.1: 修改 export 签名**

In `components/MessageView.tsx`，line 68 把：

```typescript
export function MessageView({ message, isStreaming, toolResults, modelNames, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent, showTimestamp, prevTimestamp }: Props) {
```

替换为：

```typescript
export const MessageView = React.memo(function MessageView({ message, isStreaming, toolResults, modelNames, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent, showTimestamp, prevTimestamp }: Props) {
```

注意：
- 现有 line 1 `import { useState, useRef, useEffect, useMemo } from "react";` **需扩展为** `import React, { useState, useRef, useEffect, useMemo } from "react";`（先 Edit 这一行）
- 函数体一字不动
- `React.memo` 用默认浅比较（按引用比 props），符合条件 `onFork`/`onNavigate` 引用稳定性的契约

- [ ] **Step 1.2: 类型检查 + lint**

Run: `node_modules/.bin/tsc --noEmit`
Expected: 通过，无错误。

Run: `node_modules/.bin/eslint components/MessageView.tsx`
Expected: 通过，无错误。

- [ ] **Step 1.3: 提交**

```bash
git add components/MessageView.tsx
git commit -m "perf(MessageView): wrap top-level export in React.memo"
```

---

## Task 2: 创建 `MessageList.tsx`

**Files:**
- Create: `components/MessageList.tsx`

- [ ] **Step 2.1: 写 MessageList 组件**

Create `components/MessageList.tsx`：

```typescript
import React from "react";
import type { AgentMessage, ToolResultMessage } from "@/lib/types";
import { MessageView } from "./MessageView.tsx";

interface MessageListProps {
  messages: AgentMessage[];
  entryIds: string[];
  toolResultsMap: Map<string, ToolResultMessage>;
  nextUserIdx: number[];
  nextAssistantIdx: number[];
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
  isNew: boolean;
  agentRunning: boolean;
  forkingEntryId: string | null;
  onFork: (entryId: string) => void;
  onNavigate: (entryId: string) => void;
  onEditContent: (content: string) => void;
  handleScrollToUserMsg: (idx: number) => void;
  messageRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  lastUserIdx: number;
  modelNames: Record<string, string>;
}

export const MessageList = React.memo(function MessageList({
  messages, entryIds, toolResultsMap, nextUserIdx, nextAssistantIdx,
  isStreaming, streamingMessage, isNew, agentRunning, forkingEntryId,
  onFork, onNavigate, onEditContent, handleScrollToUserMsg, messageRefs,
  lastUserIdx, modelNames,
}: MessageListProps) {
  let refIdx = 0;
  return (
    <>
      {messages.map((msg, idx) => {
        const isFirstUserMessage = idx === 0 && msg.role === "user";
        const canFork = !agentRunning && !isNew && !isFirstUserMessage;
        const canNavigate = !agentRunning;
        const isUserOrAssistant = msg.role === "user" || msg.role === "assistant";
        const showTimestamp = msg.role !== "assistant"
          || nextUserIdx[idx] !== -1
          || nextAssistantIdx[idx] === -1;
        const finalShowTimestamp = showTimestamp && !(isStreaming && idx === messages.length - 1);
        const prevAssistantEntryId = msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
          ? entryIds[idx - 1]
          : undefined;
        const prevTimestamp = idx > 0
          ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp
          : undefined;

        const view = (
          <MessageView
            key={entryIds[idx] ?? `idx-${idx}`}
            message={msg}
            toolResults={toolResultsMap}
            modelNames={modelNames}
            entryId={entryIds[idx]}
            onFork={canFork ? onFork : undefined}
            forking={forkingEntryId === entryIds[idx]}
            onNavigate={canNavigate ? onNavigate : undefined}
            prevAssistantEntryId={prevAssistantEntryId}
            onEditContent={onEditContent}
            showTimestamp={finalShowTimestamp}
            prevTimestamp={prevTimestamp}
          />
        );

        if (!isUserOrAssistant) return view;
        const currentRefIdx = refIdx++;
        return (
          <div
            key={entryIds[idx] ?? `idx-${idx}`}
            ref={(el) => {
              messageRefs.current[currentRefIdx] = el;
              if (idx === lastUserIdx) handleScrollToUserMsg(idx);
            }}
          >
            {view}
          </div>
        );
      })}
      {isStreaming && streamingMessage && (
        <MessageView message={streamingMessage as AgentMessage} isStreaming modelNames={modelNames} />
      )}
    </>
  );
});
```

- [ ] **Step 2.2: 类型检查**

Run: `node_modules/.bin/tsc --noEmit`
Expected: 应当有错——`MessageList` 当前未在 ChatWindow 中引用，但 tsc 不会因此报错。`import { MessageView } from "./MessageView.tsx"` 现在是 named import 而非之前的 `function` import，**可能**有未使用导入的 lint 警告（如果 eslint 规则开启 no-unused-vars）。但 tsc 应通过。

预期: tsc 通过、lint 通过（仅 pre-existing `MessageView.tsx` 的 `isRunning` warning——已在 P0-1 时确认）。

如果 tsc 报"`MessageList` 已声明但未使用"——可能不会，因为我们刚 import 了 `MessageView`，但 MessageList 也被 export 了，TypeScript 对未使用的 exports 不报错。OK 应该没问题。

---

## Task 3: 改 ChatWindow 集成 MessageList

**Files:**
- Modify: `components/ChatWindow.tsx` (line 295-353 IIFE 替换为 useMemo + useCallback + MessageList render)

- [ ] **Step 3.1: 加 `useMemo` 块（替换原 IIFE 的同义计算）**

In `components/ChatWindow.tsx`，找到 line 295-353 的 IIFE，**整段替换为**以下三段（按顺序）：

**第一段——useMemo toolResultsMap：**

```typescript
  const toolResultsMap = useMemo(() => {
    const m = new Map<string, ToolResultMessage>();
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        m.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
      }
    }
    return m;
  }, [messages]);
```

**第二段——useMemo nextIndices：**

```typescript
  const { nextUserIdx, nextAssistantIdx, lastUserIdx } = useMemo(() => {
    const nextUserIdx: number[] = new Array(messages.length).fill(-1);
    const nextAssistantIdx: number[] = new Array(messages.length).fill(-1);
    let lastUser = -1;
    let lastAssistant = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        nextUserIdx[i] = lastUser;
        lastUser = i;
      } else if (messages[i].role === "assistant") {
        nextAssistantIdx[i] = lastAssistant;
        lastAssistant = i;
      }
    }
    return { nextUserIdx, nextAssistantIdx, lastUserIdx: lastUser };
  }, [messages]);
```

注意：ChatWindow 原本用的是 `let lastUserIdx = -1;` 在 IIFE 内声明，**现在它被 useMemo 返回**。如果 ChatWindow 其它地方有引用 `lastUserIdx`，需要改读 useMemo 的返回值。如果原代码 IIFE 内的 `lastUserIdx` 是局部变量、外部没用，那现在丢掉就 OK。

需要确认：先 grep `components/ChatWindow.tsx` 看是否有 `lastUserIdx` 引用。若有，保持 useMemo 返回并改读；若没有，新 useMemo 内的 `lastUserIdx: lastUser` 可以省略（不返），改为：
```typescript
  const { nextUserIdx, nextAssistantIdx } = useMemo(() => {
    ...
  }, [messages]);
  const lastUserIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return i;
    }
    return -1;
  }, [messages]);
```

或更简单，把 `lastUserIdx` 单独 useMemo。如果 IIFE 内的 `lastUserIdx` 是真的只 IIFE 内用，外部不引用，可以完全删掉这一行（spec 里 MessageList 自己用 `lastUserIdx`，但 MessageList 的 lastUserIdx 来自 props）。看 spec：MessageList 接 `lastUserIdx: number` 作为 prop。所以 ChatWindow 必须 export 它。

OK 简化为单 useMemo 返回三件套最干净。

**第三段——useCallback handleEditContent 和 handleScrollToUserMsg：**

找到 line 550 附近的 `scrollUserMsgToTop` useCallback（或类似名），把它替换为：

```typescript
  const handleEditContent = useCallback((content: string) => {
    chatInputRef?.current?.insertIfEmpty(content);
  }, []);

  const handleScrollToUserMsg = useCallback((idx: number) => {
    if (idx !== lastUserIdx) return;
    const container = scrollContainerRef.current;
    const el = lastUserMsgRef.current;
    if (!container || !el) return;
    const elAbsTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: elAbsTop - 16, behavior: "smooth" });
  }, [lastUserIdx]);
```

注：原 `scrollUserMsgToTop` 函数体可参照（如果存在）拷过来；逻辑等价。

如果原函数不存在（lastUserIdx 仅 IIFE 内部用），则新加 `handleScrollToUserMsg` 的实现——`lastUserMsgRef` + `scrollContainerRef` 已存在于 ChatWindow 局部 refs。

- [ ] **Step 3.2: 替换原 IIFE 为 `<MessageList>` 渲染**

找到 line 295-353 整段 IIFE（包裹在 `{(() => { ... })()}` 里），替换为：

```typescript
            <MessageList
              messages={messages}
              entryIds={entryIds}
              toolResultsMap={toolResultsMap}
              nextUserIdx={nextUserIdx}
              nextAssistantIdx={nextAssistantIdx}
              isStreaming={streamState.isStreaming}
              streamingMessage={streamState.streamingMessage}
              isNew={isNew}
              agentRunning={agentRunning}
              forkingEntryId={forkingEntryId}
              onFork={handleFork}
              onNavigate={handleNavigate}
              onEditContent={handleEditContent}
              handleScrollToUserMsg={handleScrollToUserMsg}
              messageRefs={messageRefs}
              lastUserIdx={lastUserIdx}
              modelNames={modelNames}
            />
```

注意：原 IIFE 渲染在 JSX 内的特定位置（被 chatInputElement 上下的 div 包住），保留这个位置不动，只换掉内部。

- [ ] **Step 3.3: 加 `import { MessageList } from "./MessageList"` 到 ChatWindow 顶部 imports**

In `components/ChatWindow.tsx` 顶部 import 块，添加：

```typescript
import { MessageList } from "./MessageList";
```

（位置：按字母序插到现有 import 中间。）

- [ ] **Step 3.4: 类型检查 + lint**

Run: `node_modules/.bin/tsc --noEmit`
Expected: 通过，无错误。

Run: `node_modules/.bin/eslint .`
Expected: 通过，无错误（pre-existing `MessageView.tsx` warning 不算新错）。

如果 lint 报 `handleScrollToUserMsg` 中 `lastUserIdx` 是 stale closure 之类——检查 deps 是否正确。`useCallback(..., [lastUserIdx])` 是合理的。

- [ ] **Step 3.5: 全量测试套件**

Run: `node --test lib/*.test.ts electron/*.test.ts 'app/**/*.test.ts'`
Expected: 37/37 pass（不变——本次只动 React 组件层，不动测试逻辑）。

- [ ] **Step 3.6: 提交**

```bash
git add components/MessageList.tsx components/ChatWindow.tsx
git commit -m "perf(ChatWindow): extract MessageList + pre-compute indices + memo toolResultsMap

Long-conversation perf fixes:
- useMemo toolResultsMap / nextUserIdx / nextAssistantIdx / lastUserIdx
  (deps: messages) — replaces O(n) and O(n²) work in per-render IIFE.
- useCallback handleEditContent and handleScrollToUserMsg — stable
  references for React.memo(MessageView) and React.memo(MessageList).
- React.memo(MessageList) — skip re-render when ChatWindow state changes
  unrelated to messages.
- Stable key entryIds[idx] ?? 'idx-{idx}' — avoid remount on array shift.
- Conditional onFork/onNavigate keep stable refs across renders."
```

---

## Task 4: 验证 + Code Review + Push

- [ ] **Step 4.1: 最终验证**

Run: `node_modules/.bin/tsc --noEmit && node_modules/.bin/eslint . && node --test lib/*.test.ts electron/*.test.ts 'app/**/*.test.ts'`
Expected: 全通过。

- [ ] **Step 4.2: 派 code reviewer**

按 `superpowers:requesting-code-review` skill 派 general-purpose subagent 审查本 PR 的 2 commit（base = Task 1 之前，head = 当前）。

- [ ] **Step 4.3: 应用 review 修复（如有）**

按 review 反馈修复 Critical / Important 问题，Minor 留给后续。

- [ ] **Step 4.4: Push 到远端**

If review 干净（或修复后干净）：

```bash
git push -u origin analysis/architecture-optimization-review
```

如果用户后续决定开 PR，单独走 `finishing-a-development-branch` 的 Option 2 流程。

- [ ] **Step 4.5: 写 PR 描述草稿（手动验证清单）**

P0-5 手动验证 4 条（打开 100+ 消息会话，Profiler 录制，触发打字/滚动/stream/fork 切换）。

---

## Self-Review

**1. Spec 覆盖**：
- MessageList 抽到独立文件 → Task 2 step 2.1 ✓
- useMemo toolResultsMap / nextUserIdx / nextAssistantIdx / lastUserIdx → Task 3 step 3.1 ✓
- useCallback handleEditContent / handleScrollToUserMsg → Task 3 step 3.1 ✓
- React.memo(MessageView) 顶层 export → Task 1 ✓
- 条件 onFork/onNavigate 引用稳定 → Task 2 step 2.1 内的 `canFork ? onFork : undefined` ✓
- stable key entryIds[idx] → Task 2 step 2.1 ✓
- 错误处理（无新增）✓
- 测试策略（无自动化测试、Profiler 手动验证）→ Task 4 step 4.5 ✓
- 验证清单 → Task 4 step 4.1 ✓
- 实施顺序（MessageView memo → MessageList 创建 → ChatWindow 集成）→ 3 tasks 顺序一致 ✓
- PR 范围（1 新建 + 2 修改、~120 行、1 个 commit）→ 实际 2 commit（MessageView memo + 集成）✓

**2. 占位符扫描**：无 TBD/TODO/未定义引用；所有代码块完整。

**3. 类型一致性**：
- `MessageListProps` 14 字段 — Task 2 定义、Task 3 引用、ChatWindow 调用全部一致 ✓
- `React.memo` 用默认浅比较 — 一致 ✓
- `useMemo` deps `[messages]` — Task 3 三个 memo 都用 ✓
- `useCallback` deps — `[]` for handleEditContent（chatInputRef 稳定）、`[lastUserIdx]` for handleScrollToUserMsg（依赖 lastUserIdx）✓

**Inline 修正**：
- spec 估算"~120 行变动"——实际：MessageList.tsx 约 110 行（+3 行 MessageView）≈ 115-120 行。OK 接受原估算。
- 风险表里写 `handleScrollToUserMsg` 在 ChatWindow 中定义——Plan Task 3 step 3.1 第三段落实。一致。
