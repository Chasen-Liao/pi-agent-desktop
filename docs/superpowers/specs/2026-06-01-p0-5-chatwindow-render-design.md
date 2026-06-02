# P0-5 ChatWindow 渲染性能优化设计

> 分支：`analysis/architecture-optimization-review` · 日期：2026-06-01 · 关联评审：`docs/architecture-review-2026-06-01.md` §1 P0-5

## 背景

`components/ChatWindow.tsx:295-353` 把消息列表的渲染包在一个 IIFE 里，每次 ChatWindow render 都会：
- 建 `toolResultsMap`（O(n)，new Map）
- 反向扫描找 `lastUserIdx`（O(n)）
- 对每条消息 forward scan 找下一个 user/assistant（O(n) per message → O(n²) worst case）
- 用 `idx` 作 key（消息数组调整时整列 unmount/remount）

长对话（100+ 消息）下：
- 流式推送时，ChatWindow re-render 触发 O(n²) 的 forward scan
- 任何 ChatWindow state 变化（输入框打字、滚动、useTheme 触发）都会让每条 `MessageView` 重新渲染
- `MessageView` 没有 `React.memo` 包装

详见评审 doc P0-5 条目。

## 目标

- 流式推送时 ChatWindow re-render 不触发 O(n²) 计算
- ChatWindow 任意 state 变化（不涉及消息）时，**每条** `MessageView` 都不重新渲染
- 消息数组调整时，**不**因 key 变化而整列 unmount/remount
- 不引入新 npm 依赖

## 非目标

- 不引入虚拟滚动（`react-window` / `react-virtuoso`）—— 范围大、独立 P
- 不重构 `MessageView` 内部（847 行、4 个子组件已自洽）
- 不修 `FileViewer` 的 SyntaxHighlighter 性能
- 不改 `entryIds` 生成逻辑
- 不动 `MessageView` 的 props 接口（保持向后兼容）

## 方案概览

| 文件 | 动作 | 职责 |
|---|---|---|
| `components/MessageList.tsx` | 新建 | 消息列表子组件，包 `React.memo` |
| `components/ChatWindow.tsx` | 修改 | useMemo 预计算 + 委托给 MessageList + useCallback 提取内联回调 |
| `components/MessageView.tsx` | 修改 | 顶层 export 包 `React.memo` |

## `components/MessageList.tsx`（新建）

```typescript
import React, { useMemo } from "react";
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
        // Hide on the currently-streaming tail
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

注：`handleScrollToUserMsg(idx)` 替代原 IIFE 的 `lastUserMsgRef.current = el` 写法——把 ref 收拢逻辑也搬过来。`handleScrollToUserMsg` 来自父级 `useCallback`，引用稳定。

## `components/ChatWindow.tsx`（修改）

### useMemo 预计算（替换原 IIFE 内的同义计算）

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

### useCallback 提取内联回调（`onEditContent`）

原：
```typescript
onEditContent={(content) => chatInputRef?.current?.insertIfEmpty(content)}
```

改为：
```typescript
const handleEditContent = useCallback((content: string) => {
  chatInputRef?.current?.insertIfEmpty(content);
}, []);
```

注：`chatInputRef` 是 `useRef` 创建的 ref，引用稳定，因此 `useCallback` deps 用 `[]` 即可。

### `handleScrollToUserMsg` useCallback

```typescript
const handleScrollToUserMsg = useCallback((idx: number) => {
  if (idx === lastUserIdx) {
    const container = scrollContainerRef.current;
    const el = lastUserMsgRef.current;
    if (container && el) {
      const elAbsTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top: elAbsTop - 16, behavior: "smooth" });
    }
  }
}, [lastUserIdx]);
```

注：原 `scrollUserMsgToTop` 函数已存在，包成 useCallback 让 MessageList 的 `ref` 回调引用稳定。deps 是 `lastUserIdx`（如果 lastUserIdx 变了，handleScrollToUserMsg 引用变；这个变化是合理的——lastUserIdx 改变时 MessageList 重 render 是预期的）。

### 替换 IIFE 为 MessageList 渲染

原 IIFE（line 295-353）整段替换为：
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

## `components/MessageView.tsx`（修改）

找到顶层 export（line 68）：
```typescript
export function MessageView({ message, isStreaming, toolResults, modelNames, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent, showTimestamp, prevTimestamp }: Props) {
```

改为：
```typescript
export const MessageView = React.memo(function MessageView({ message, isStreaming, toolResults, modelNames, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent, showTimestamp, prevTimestamp }: Props) {
  // ... 现有实现完全不动
});
```

变更点：
- `function` 改为 `const ... = React.memo(function ...)`
- 函数体一字不动
- 添加 `import React from "react"`（项目现有 import 中已有 `from "react"`，复用即可）

## 数据流

```
ChatWindow re-renders
  │
  ├─ useMemo toolResultsMap  (deps: messages)  → 同引用除非 messages 变
  ├─ useMemo nextUserIdx/nextAssistantIdx/lastUserIdx  (deps: messages)  → 同引用除非 messages 变
  ├─ useCallback handleEditContent  (deps: [])  → 永远同引用
  ├─ useCallback handleScrollToUserMsg  (deps: lastUserIdx)  → 引用在 lastUserIdx 变时变（合理）
  │
  └─ <MessageList props={...}>
        │
        └─ React.memo: 比较 props 引用
             │
             └─ 全等（messages 没变、callbacks 同引用）→ skip render
                  │
                  └─ 不等（messages 变了）→ render
                        │
                        └─ messages.map → <MessageView />
                             │
                             └─ React.memo: 比较 props 引用
                                  │
                                  └─ 全等（message 没变、toolResultsMap 同引用、onFork 同引用）→ skip render
                                       │
                                       └─ 不等 → render
```

## 错误处理

无新增错误路径。这是纯性能重构，行为不变。

## 测试策略

- **不写自动化测试**：项目无 React testing infra（`node --test` 不能 mount React 组件）
- **手动验证**（React Profiler）写进 PR description

### 手动验证清单

- [ ] 打开一个有 100+ 消息的会话；用 React DevTools Profiler 录制 ChatWindow
- [ ] 在 chat input 打字（不应触发 `MessageList` / `MessageView` 渲染）
- [ ] 滚动消息列表（不应触发）
- [ ] 触发 stream 推送（流式消息应该实时更新；其他消息不应 re-render；forward scan 不应出现）
- [ ] fork 一个会话，观察子会话的 MessageView 在切到子会话时不重新加载（cache 命中）

## 范围外（本次 P0-5 不做）

- 虚拟滚动
- `MessageView` 内部重构
- `FileViewer` SyntaxHighlighter 性能
- `entryIds` 生成逻辑

## 风险

| 风险 | 缓解 |
|---|---|
| `React.memo(MessageView)` 按引用比较；`toolResultsMap` 若被绕过 useMemo 会失效 | code review 把关：ChatWindow 内的 `toolResultsMap` 必须始终是 useMemo 的返回值 |
| 条件 `onFork`/`onNavigate` 引用稳定性依赖 `handleFork`/`handleNavigate` 是稳定引用 | 已在 P0-3 中将 `useAgentSession` 的对应 useCallback 依赖收敛；本次不修改 |
| 抽出 MessageList 为独立文件增加模块数 | 117 行（按 spec），可接受 |
| `handleScrollToUserMsg` deps 是 `lastUserIdx`——会随 lastUserIdx 变化重新创建 | 合理：lastUserIdx 改变说明消息列表变了，MessageList 重新 render 是预期的 |
| `key={entryIds[idx] ?? 'idx-${idx}'}` 的 fallback 在 entryIds 缺失时回退到 `idx-` 形式 | 仍保持稳定（同 idx 同 fallback）；不是最优但是正确 |

## 验证清单

- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run lint` 通过
- [ ] 全量测试套件（37 tests）通过
- [ ] Profiler 手动验证 4 条通过

## 实施顺序

1. `components/MessageView.tsx` 顶层 export 包 `React.memo`（最小、独立、~3 行）
2. `components/MessageList.tsx` 新建（~120 行）
3. `components/ChatWindow.tsx` useMemo + useCallback + 替换 IIFE
4. tsc + lint + 全量测试
5. commit

## PR 范围

- 1 文件新建（`components/MessageList.tsx`）
- 2 文件修改（`components/ChatWindow.tsx` 替换 IIFE、`components/MessageView.tsx` 包 React.memo）
- 总计 ~120 行变动（~110 行新建 + ~10 行 ChatWindow + ~3 行 MessageView 顶部 export）
- 一个 commit，一个 PR
