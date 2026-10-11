Pi Agent Desktop 将每个对话会话持久化为 **JSON Lines (.jsonl)** 格式的文件。路径由上游 `SessionManager` 决定：

- 目录：`~/.pi/agent/sessions/--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--/`
- 文件名：`${isoTimestamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`（`sessionId` 为 uuidv7）

这种格式兼具**流式追加写入**的高性能与**行级解析**的简洁性。本文档说明文件结构、条目类型、解析流程、上下文重建算法，以及跨文件 Fork / Branch / Clone 与同文件会话内分支对文件的影响。

## 文件整体结构

每个 `.jsonl` 文件由 **首行会话头** + **若干条目行** 组成，每行独立为合法 JSON 对象。

```mermaid
graph TD
    A[.jsonl 文件] --> B[第 1 行: SessionHeader]
    A --> C[第 2..N 行: SessionEntry[]]
    B --> B1[type: "session"]
    B --> B2[id: string]
    B --> B3[version?: number]
    B --> B4[timestamp: ISO8601]
    B --> B5[cwd: string]
    B --> B6[parentSession?: string]
    C --> C1[type: "message" | "thinking_level_change" | ...]
    C --> C2[id: string]
    C --> C3[parentId: string | null]
    C --> C4[timestamp: ISO8601]
    C --> C5[...payload]
```

**示例文件片段**：

```jsonl
{"type":"session","version":3,"id":"01234567-89ab-7cde-8f01-23456789abcd","timestamp":"2026-09-30T10:00:00.000Z","cwd":"/home/user/project","parentSession":"/home/user/.pi/agent/sessions/--home-user-project--/2026-09-29T09-00-00-000Z_parent-uuid.jsonl"}
{"type":"message","id":"e1","parentId":null,"timestamp":"2026-09-30T10:00:05.000Z","message":{"role":"user","content":"帮我重构 auth.ts"}}
{"type":"message","id":"e2","parentId":"e1","timestamp":"2026-09-30T10:00:10.000Z","message":{"role":"assistant","model":"claude-3-5-sonnet","provider":"anthropic","content":[{"type":"thinking","thinking":"需要先理解现有结构..."},{"type":"text","text":"好的，我来分析一下..."},{"type":"toolCall","id":"tc-1","name":"read","arguments":{"path":"/home/user/project/auth.ts"}}]}}
{"type":"message","id":"e3","parentId":"e2","timestamp":"2026-09-30T10:00:15.000Z","message":{"role":"toolResult","toolCallId":"tc-1","toolName":"read","content":[{"type":"text","text":"export const auth = ..."}],"isError":false}}
{"type":"session_info","id":"e4","parentId":"e3","timestamp":"2026-09-30T10:05:00.000Z","name":"重构认证模块 v2"}
```

磁盘上的 `toolCall` 块使用 SDK 字段 `{id, name, arguments}`。前端 `lib/types.ts` 的 `ToolCallContent` 是 `{toolCallId, toolName, input}`；`normalizeToolCalls()` 在文件加载（`session-reader.ts`）与 SSE 流（`agent-event-apply.ts`）两条路径上做转换。下文 JSONL 示例一律写磁盘格式。

Sources: [lib/types.ts](lib/types.ts#L1-L50), [lib/session-reader.ts](lib/session-reader.ts#L200-L230), [lib/session-export.test.ts](lib/session-export.test.ts#L60-L80)

---

## 会话头

`SessionHeader` 位于文件首行，标识会话的元数据。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `"session"` | ✓ | 字面量常量，用于识别首行 |
| `version` | `number` | ✗ | 格式版本，当前为 3 |
| `id` | `string` | ✓ | 会话全局唯一 ID（uuidv7，`createSessionId()`） |
| `timestamp` | `string` | ✓ | 创建时间，ISO 8601 格式 |
| `cwd` | `string` | ✓ | 会话关联的工作目录绝对路径 |
| `parentSession` | `string` | ✗ | 父会话文件路径，分支/克隆时设置 |

**关键行为**：
- `parentSession` 存储的是**父会话的文件绝对路径**，而非父会话 ID。删除父会话时，`session-cascade.ts` 会将子会话的 `parentSession` 改写为祖父会话路径或移除。
- 上游 `SessionHeader` **没有** `name` 字段（`lib/types.ts` 的本地镜像类型保留了 `name?`，但实际文件头不写入该字段）；会话名称经 `session_info` 条目记录（重命名时由 `PATCH /api/sessions/[id]` 调用 `appendSessionInfo` 追加）。
- 首行读取使用流式读取 (`readFirstLineAsync`)，避免加载整个大文件。

Sources: [lib/types.ts](lib/types.ts#L1-L15), [lib/session-reader.ts](lib/session-reader.ts#L130-L165), [lib/session-cascade.ts](lib/session-cascade.ts#L1-L54), [app/api/sessions/[id]/route.ts](app/api/sessions/%5Bid%5D/route.ts#L150-L170)

---

## 条目基类与通用字段

所有条目继承 `SessionEntryBase`：

```typescript
interface SessionEntryBase {
  type: string;           // 判别字段
  id: string;             // 条目唯一 ID (UUID)
  parentId: string | null; // 父条目 ID，根条目为 null
  timestamp: string;      // ISO 8601 时间戳
}
```

`parentId` 构成**同一 `.jsonl` 内的条目树**（非线性历史）。**会话内分支**靠它切换叶子；跨文件 Fork / Branch 则把根→叶路径复制进**新文件**，新文件头的 `parentSession` 才是会话级父子指针。`buildTree` 根据 `parentId` 重建树，并按时间戳排序子节点。`SessionContext.entryIds[]` 与 `messages[]` 一一对应，把 UI 消息映射回条目 ID（Fork 的 `entryId`、Branch API 的 `targetEntryId`、`?leafId=` 都用它）。

Sources: [lib/types.ts](lib/types.ts#L16-L22), [lib/session-reader.ts](lib/session-reader.ts#L167-L200)

---

## 条目类型详解

### 1. 消息条目 (`type: "message"`)

核心对话内容，`message` 字段为 `AgentMessage` 联合类型。

#### User Message
```json
{
  "type": "message",
  "id": "e1",
  "parentId": null,
  "timestamp": "2026-09-30T10:00:05.000Z",
  "message": {
    "role": "user",
    "content": "帮我重构 auth.ts",
    "timestamp": 1727690405000
  }
}
```
- `content`: `string` 或 `TextContent[] | ImageContent[]`（多模态）
- `clientMessageId` / `deliveryState`: **仅客户端使用**，不持久化到 JSONL

#### Assistant Message
```json
{
  "type": "message",
  "id": "e2",
  "parentId": "e1",
  "timestamp": "2026-09-30T10:00:10.000Z",
  "message": {
    "role": "assistant",
    "model": "claude-3-5-sonnet",
    "provider": "anthropic",
    "content": [
      {"type": "thinking", "thinking": "需要先理解现有结构..."},
      {"type": "text", "text": "好的，我来分析一下..."},
      {"type": "toolCall", "id": "tc-1", "name": "read", "arguments": {"path": "/home/user/project/auth.ts"}}
    ],
    "stopReason": "tool_use",
    "usage": {
      "input": 1200,
      "output": 300,
      "cacheRead": 500,
      "cacheWrite": 0,
      "cost": {"input": 0.0036, "output": 0.0045, "cacheRead": 0.0005, "cacheWrite": 0, "total": 0.0086}
    },
    "timestamp": 1727690410000
  }
}
```
- `content`：磁盘上 `toolCall` 为 `{type, id, name, arguments}`；经 `normalizeToolCalls` 后前端为 `{type, toolCallId, toolName, input}`
- `usage`: Token 统计与成本，用于 StatsBar 显示

#### Tool Result Message
```json
{
  "type": "message",
  "id": "e3",
  "parentId": "e2",
  "timestamp": "2026-09-30T10:00:15.000Z",
  "message": {
    "role": "toolResult",
    "toolCallId": "tc-1",
    "toolName": "read",
    "content": [{"type": "text", "text": "export const auth = ..."}],
    "isError": false,
    "timestamp": 1727690415000
  }
}
```

#### Custom Message
```json
{
  "type": "message",
  "id": "e5",
  "parentId": "e4",
  "timestamp": "2026-09-30T10:05:00.000Z",
  "message": {
    "role": "custom",
    "customType": "plan",
    "content": "## 执行计划\n1. 分析现有代码\n2. 编写测试\n3. 重构",
    "display": true,
    "details": {"steps": ["...", "..."]},
    "timestamp": 1727690700000
  }
}
```
- 用于 Plan 模式、Ask 拦截等 UI 级消息

Sources: [lib/types.ts](lib/types.ts#L23-L100), [lib/session-export.ts](lib/session-export.ts#L1-L50), [lib/normalize.ts](lib/normalize.ts#L1-L30)

---

### 2. 思考等级变更 (`type: "thinking_level_change"`)

```json
{
  "type": "thinking_level_change",
  "id": "e6",
  "parentId": "e5",
  "timestamp": "2026-09-30T10:06:00.000Z",
  "thinkingLevel": "high"
}
```
- 记录用户在对话中切换 thinking level（low/medium/high/max）
- `buildSessionContext` 会在返回的 `SessionContext.thinkingLevel` 中体现最新值

Sources: [lib/types.ts](lib/types.ts#L102-L107)

---

### 3. 模型切换 (`type: "model_change"`)

```json
{
  "type": "model_change",
  "id": "e7",
  "parentId": "e6",
  "timestamp": "2026-09-30T10:07:00.000Z",
  "provider": "anthropic",
  "modelId": "claude-3-opus"
}
```
- 记录对话中途切换模型
- `SessionContext.model` 反映当前生效模型

Sources: [lib/types.ts](lib/types.ts#L109-L114)

---

### 4. 压缩摘要 (`type: "compaction"`)

上下文窗口满时触发自动/手动压缩，生成摘要条目：

```json
{
  "type": "compaction",
  "id": "e8",
  "parentId": "e7",
  "timestamp": "2026-09-30T10:10:00.000Z",
  "summary": "用户请求重构 auth.ts，助手阅读了文件并分析了结构...",
  "firstKeptEntryId": "e3",
  "tokensBefore": 150000,
  "details": {"strategy": "summary", "model": "claude-3-haiku"},
  "fromHook": false
}
```
- `firstKeptEntryId`: 压缩后保留的最早条目 ID
- `tokensBefore`: 压缩前 token 数
- **渲染时转换**：`buildSessionContext` 将上游返回的 `role: "compactionSummary"` 转为 `role: "user"`，内容前缀 `*The conversation history before this point was compacted into the following summary:*`，复用现有 MessageView 渲染

Sources: [lib/types.ts](lib/types.ts#L116-L124), [lib/session-reader.ts](lib/session-reader.ts#L180-L195), [lib/session-export.ts](lib/session-export.ts#L110-L115)

---

### 5. 分支摘要 (`type: "branch_summary"`)

会话内分支创建时记录：

```json
{
  "type": "branch_summary",
  "id": "e9",
  "parentId": "e8",
  "timestamp": "2026-09-30T10:12:00.000Z",
  "fromId": "e3",
  "summary": "从「阅读文件」节点分支，尝试方案 B",
  "details": {"branchName": "方案B"},
  "fromHook": false
}
```
- `fromId`: 分支起点条目 ID
- 用于 BranchNavigator 显示分支起源

Sources: [lib/types.ts](lib/types.ts#L126-L133)

---

### 6. 自定义条目 (`type: "custom"`)

扩展点，供插件/技能存储任意数据：

```json
{
  "type": "custom",
  "id": "e10",
  "parentId": "e9",
  "timestamp": "2026-09-30T10:13:00.000Z",
  "customType": "skill.checkpoint",
  "data": {"skill": "code-review", "phase": "complete"}
}
```

Sources: [lib/types.ts](lib/types.ts#L135-L140)

---

### 7. 自定义消息条目 (`type: "custom_message"`)

与 `role: "custom"` 消息类似，但作为独立条目类型存储：

```json
{
  "type": "custom_message",
  "id": "e11",
  "parentId": "e10",
  "timestamp": "2026-09-30T10:14:00.000Z",
  "customType": "approval_request",
  "content": "需要权限执行 rm -rf",
  "details": {"tool": "bash", "command": "rm -rf dist"},
  "display": true
}
```

Sources: [lib/types.ts](lib/types.ts#L142-L149), [lib/session-export.ts](lib/session-export.ts#L116-L125)

---

### 8. 标签条目 (`type: "label"`)

为任意条目添加/移除标签（用于书签、TODO 标记）：

```json
{"type":"label","id":"e12","parentId":"e11","timestamp":"2026-09-30T10:15:00.000Z","targetId":"e3","label":"关键决策点"}
{"type":"label","id":"e13","parentId":"e12","timestamp":"2026-09-30T10:16:00.000Z","targetId":"e3","label":null}
```
- `label` 为 `undefined`/`null` 表示移除标签
- `buildTree` 收集所有 label 条目构建 `labelsById` 映射，挂载到 `SessionTreeNode.label`

Sources: [lib/types.ts](lib/types.ts#L151-L156), [lib/session-reader.ts](lib/session-reader.ts#L167-L180)

---

### 9. 会话信息更新 (`type: "session_info"`)

用户重命名会话时追加：

```json
{
  "type": "session_info",
  "id": "e14",
  "parentId": "e13",
  "timestamp": "2026-09-30T10:20:00.000Z",
  "name": "重构认证模块 - 完成"
}
```
- `getSessionName` 从后向前扫描取最新 `session_info.name`

Sources: [lib/types.ts](lib/types.ts#L158-L162), [lib/session-reader.ts](lib/session-reader.ts#L235-L245)

---

### 10. 上下文编辑 (`type: "context_edit"`)

**核心机制**：允许在不删除原条目的前提下，**从上下文投影中省略或替换**特定条目。用于同一文件内的会话内分支、压缩，以及跨文件 Fork/Branch 复制路径时已存在的 `context_edit`。

```json
{"type":"context_edit","id":"e15","parentId":"e14","timestamp":"2026-09-30T10:21:00.000Z","targetId":"e1","replacement":null}
{"type":"context_edit","id":"e16","parentId":"e15","timestamp":"2026-09-30T10:22:00.000Z","targetId":"e2","replacement":{"content":"替换后的用户问题"}}
```
- `replacement: null` → **省略**该条目（不纳入上下文投影）
- `replacement: { content: ... }` → **替换**该条目的 message.content
- `buildSessionContext` 内部调用上游 `buildSessionProjection`，后者基于 `context_edit` 链计算最终可见消息序列，**保留 provenance（entryIds 追踪原始条目）**

Sources: [lib/types.ts](lib/types.ts#L164-L168), [lib/session-reader.ts](lib/session-reader.ts#L175-L195), [lib/session-reader.test.ts](lib/session-reader.test.ts#L1-L19)

---

### 11. 用量统计 (`type: "usage"`)

上游 SDK 记录的非消息类 token 用量条目（如缓存预热等场景）：

```json
{
  "type": "usage",
  "id": "e17",
  "parentId": "e16",
  "timestamp": "2026-09-30T10:23:00.000Z",
  "kind": "cache_warm",
  "provider": "anthropic",
  "model": "claude-3-5-sonnet",
  "usage": {"input": 0, "output": 0, "cacheRead": 150000, "cacheWrite": 0, "cost": {"total": 0}},
  "note": "可选的人类可读说明"
}
```
- `kind`: 用量类别（任意字符串，如 `cache_warm`）
- `usage`: 与 Assistant Message 的 `usage` 同构的 Token 统计与成本
- `note?`: 可选的人类可读限定说明

Sources: [node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts](node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts#L36-L45)

---

## 解析流程

### 1. 读取全量条目 (`getSessionEntriesAsync`)

```typescript
export async function getSessionEntriesAsync(filePath: string): Promise<SessionEntry[]> {
  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n");
  const entries: SessionEntry[] = [];
  for (const line of lines) {
    if (line.trim()) {
      try {
        entries.push(JSON.parse(line) as SessionEntry);
      } catch (err) {
        console.error("Failed to parse JSONL line:", line, err);
      }
    }
  }
  return entries;
}
```

**特点**：
- 全文读入内存 → 适合中小型会话（< 10MB）
- 逐行 `JSON.parse`，单行损坏不影响后续行
- 返回数组包含首行 `SessionHeader`（作为 `type: "session"` 条目）

Sources: [lib/session-reader.ts](lib/session-reader.ts#L205-L225)

---

### 2. 读取首行头 (`readFirstLineAsync` / `getHeaderAsync`)

```typescript
export function readFirstLineAsync(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: "utf8", highWaterMark: 4096 });
    let buffer = "";
    let resolved = false;
    stream.on("data", (chunk) => {
      buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      const idx = buffer.indexOf("\n");
      if (idx !== -1) {
        resolved = true;
        resolve(buffer.slice(0, idx));
        stream.destroy();
      }
    });
    stream.on("end", () => { if (!resolved) resolve(buffer || null); });
    stream.on("error", (err) => { console.error(...); if (!resolved) resolve(null); });
  });
}
```

**用途**：
- `getHeaderAsync` 内部读取会话头（供 `GET /api/agent/[id]` 与 SSE `/api/agent/[id]/events` 冷启动使用）
- `DELETE` 操作读取父会话路径以实现级联重写
- 导出 API 不经过它：用 `existsSync` 校验存在性 + `getSessionEntriesAsync` 全量读取

Sources: [lib/session-reader.ts](lib/session-reader.ts#L130-L165), [app/api/sessions/[id]/route.ts](app/api/sessions/%5Bid%5D/route.ts#L150-L160)

---

### 3. 树构建 (`buildTree`)

```typescript
export function buildTree(entries: SessionEntry[]): SessionTreeNode[] {
  const nodeMap = new Map<string, SessionTreeNode>();
  const labelsById = new Map<string, string>();

  // 1. 收集 label 条目
  for (const entry of entries) {
    if (entry.type === "label") {
      const l = entry as LabelEntry;
      if (l.label) labelsById.set(l.targetId, l.label);
      else labelsById.delete(l.targetId);
    }
  }

  // 2. 创建节点
  for (const entry of entries) {
    nodeMap.set(entry.id, { entry, children: [], label: labelsById.get(entry.id) });
  }

  // 3. 挂载父子关系
  const roots: SessionTreeNode[] = [];
  for (const entry of entries) {
    const node = nodeMap.get(entry.id)!;
    if (!entry.parentId) roots.push(node);
    else {
      const parent = nodeMap.get(entry.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node); // 孤儿节点挂根
    }
  }

  // 4. 递归按时间戳排序
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    node.children.sort((a, b) => new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime());
    stack.push(...node.children);
  }
  return roots;
}
```

**输出**：`SessionTreeNode[]`，前端 `SessionSidebar` 递归渲染。

Sources: [lib/session-reader.ts](lib/session-reader.ts#L167-L200)

---

### 4. 上下文投影 (`buildSessionContext`)

最复杂的环节，委托给上游 `@earendil-works/pi-coding-agent` 的 `buildSessionProjection`：

```typescript
export function buildSessionContext(entries: SessionEntry[], leafId?: string | null): SessionContext {
  const piEntries = entries as unknown as PiSessionEntry[];
  const byId = new Map(piEntries.map((entry) => [entry.id, entry]));
  const piCtx = buildSessionProjection(piEntries, leafId, byId);
  
  // 保留 provenance：每条最终消息对应的源条目 ID
  const entryIds = piCtx.entries.flatMap((entry) => 
    entry.messages.map(() => entry.sourceEntry.id)
  );

  // 转换 compactionSummary → user role
  const messages = (piCtx.messages as AssistantMessage[]).map((msg) => {
    const raw = msg as unknown as Record<string, unknown>;
    if (raw.role === "compactionSummary") {
      return {
        role: "user" as const,
        content: `*The conversation history before this point was compacted into the following summary:*\n\n${raw.summary ?? ""}",
        timestamp: raw.timestamp as number | undefined,
      };
    }
    return normalizeToolCalls(msg);
  });

  return { messages, entryIds, thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
}
```

**关键点**：
- `leafId` 指定“当前叶子条目”，投影包含从根到该叶子的路径上所有可见消息
- `context_edit` 链可导致中间条目被省略/替换，**原始 JSONL 不变**，仅投影视图变化
- `entryIds` 与 `messages` 一一对应，前端用于“定位到条目”、分支创建时的 `targetEntryId`

Sources: [lib/session-reader.ts](lib/session-reader.ts#L175-L210), [lib/session-reader.test.ts](lib/session-reader.test.ts#L1-L19)

---

## 会话列表与路径缓存

### `listAllSessions()`

```typescript
export async function listAllSessions(): Promise<SessionInfo[]> {
  const piSessions: PiSessionInfo[] = await SessionManager.listAll();
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(s.path, s.id);

  const state = getPathCacheState();
  return piSessions.map((s) => {
    cacheSessionPathEntry(state, s.id, s.path);
    const leafEntryId = s.leafEntryId; // Pi 0.87+ 暴露
    return {
      path: s.path, id: s.id, cwd: s.cwd, name: s.name,
      created: s.created.toISOString(), modified: s.modified.toISOString(),
      messageCount: s.messageCount, firstMessage: s.firstMessage || "(no messages)",
      parentSessionId: s.parentSessionPath ? pathToId.get(s.parentSessionPath) : undefined,
      leafEntryId,
    };
  });
}
```

- 调用上游 `SessionManager.listAll()` 扫描目录
- 同步填充**路径缓存** (`session-path-cache.ts`)：`sessionId → 绝对路径`
- 解析 `parentSessionPath` → `parentSessionId` 供前端树形展示

### 路径缓存 (`session-path-cache.ts`)

```typescript
// 正向缓存 + 短 TTL 负向缓存 (30s)
export const SESSION_MISS_TTL_MS = 30_000;
type SessionPathCacheState = { paths: Map<string, string>; misses: Map<string, number> };

function getCachedSessionPath(state, sessionId, now = Date.now()) {
  const path = state.paths.get(sessionId);
  if (path) return { hit: true, path };
  const missUntil = state.misses.get(sessionId);
  if (missUntil !== undefined && now < missUntil) return { hit: false, negative: true };
  return { hit: false, negative: false };
}
```

**设计权衡**：
- 正向缓存永久有效（直到 `invalidateSessionPathCache` / `invalidateSessionPathEntry`）
- 负向缓存 30s TTL：挡住随机 ID 全盘扫描，同时缩短“先查后建”误 404 窗口
- 存活的 RPC wrapper（`globalThis.__piSessions` 且 `isAlive()`）**绕过过期前的负向命中**：删 miss 后 `listAllSessions()` 重扫，避免 Fork 预注册后被 30s 负向缓存挡住

Sources: [lib/session-reader.ts](lib/session-reader.ts#L25-L80), [lib/session-path-cache.ts](lib/session-path-cache.ts#L1-L57)

---

## 分支与克隆对文件的影响

| 操作 | 触发 | 产物文件 | 首行 `parentSession` | 条目内容 |
|------|------|----------|---------------------|----------|
| **Fork** | `POST /api/agent/[id]` `{type:"fork", entryId}`（消息 Fork 按钮）。**没有** `POST /api/sessions/fork` | 新 `.jsonl` | 父会话**文件绝对路径** | `entry.parentId === null`（首条消息前）：`SessionManager.create` + `newSession({ parentSession })`；否则 `createBranchedSession(entry.parentId)`，复制到 fork 点**之前**（不含该条）。随后 `startRpcSession(newId)` 预注册，再 `destroy()` 旧 wrapper |
| **会话内分支** | Continue / `BranchNavigator`：`navigate_tree` + `GET /api/sessions/[id]/context?leafId=`。**不是** `POST /api/sessions/[id]/branch` | **同一** `.jsonl` | 不改会话头 | 条目 `parentId` 成树；投影按叶子路径，原始文件不动 |
| **跨文件 Branch API** | `POST /api/sessions/[id]/branch` `{ targetEntryId, name? }`（侧边栏从节点分叉） | 新 `.jsonl` | 父会话**文件绝对路径** | `createBranchedSession(targetEntryId)` 复制根→叶（**含**目标条目） |
| **Clone（directory）** | `POST /api/sessions/[id]/clone`，`workspaceMode: "directory"`（默认） | 新 `.jsonl` | 父会话**文件绝对路径** | `SessionManager.forkFrom` 复制全部非头条目（含整棵条目树） |
| **Clone（worktree）** | 同上，`workspaceMode: "worktree"` | 新 `.jsonl` + 仓库外 worktree | 父会话**文件绝对路径** | 同 `forkFrom`；目标路径 / `gitDir` / HEAD / 分支所有权无法证明时 fail closed |

**代码关键点**：

跨文件 Fork / Branch 走 `createBranchedSession`（或首条前的 `create`）；Clone 走 `forkFrom`。`lib/session-branch-clone.ts` 的 `extractAncestryPath` / `createBranchedHeader` 为**死代码**（仅定义与测试引用，无生产调用）。

Sources: [node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js](node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js#L1205-L1248), [lib/rpc-manager.ts](lib/rpc-manager.ts#L436-L501), [app/api/sessions/[id]/branch/route.ts](app/api/sessions/%5Bid%5D/branch/route.ts#L1-L87), [app/api/sessions/[id]/clone/route.ts](app/api/sessions/%5Bid%5D/clone/route.ts#L1-L100)

---

## 导出格式

### Markdown 导出 (`formatEntriesToMarkdown`)

将条目序列转为人类可读 Markdown：

| 条目类型 | Markdown 输出 |
|----------|---------------|
| User | `## User\n\n{content}` |
| Assistant | `## Assistant\n\n{thinking}\n{text}\n### Tool Call: \`name\`\n\`\`\`json\n{arguments 或 input}\n\`\`\``（导出前会归一化） |
| ToolResult | `### Tool Result: \`name\`{(Error)}\n\`\`\`\n{content}\n\`\`\`` |
| Compaction | `> *Session compacted: {summary}*` |
| Custom | `## Custom ({customType})\n\n{content}` |

Sources: [lib/session-export.ts](lib/session-export.ts#L1-L135), [lib/session-export.test.ts](lib/session-export.test.ts#L10-L120)

### HTML 导出 (`exportSessionToHtml`)

调用上游原生导出器（`@earendil-works/pi-coding-agent/dist/core/export-html`），产出**自包含单文件 HTML**，内嵌 Base64 编码的完整会话数据，支持离线查看、主题切换、消息折叠。

Sources: [lib/session-export.ts](lib/session-export.ts#L130-L135), [app/api/sessions/[id]/export/route.ts](app/api/sessions/%5Bid%5D/export/route.ts#L1-L77)

---

## 并发与原子性保障

### 文件锁 (`withFileLock`)

进程内按**绝对路径**串行化写操作：

```typescript
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(filePath);
  const locks = (globalThis.__piWriteLocks ??= new Map());
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ourEntry = prev.then(() => gate);
  locks.set(key, ourEntry);
  try { await prev; return await fn(); }
  finally { release(); if (locks.get(key) === ourEntry) locks.delete(key); }
}
```

- 防止同一文件并发 `append` / `rewrite` / `unlink` 竞态
- **不支持重入**，嵌套调用同一路径会死锁

Sources: [lib/session-lock.ts](lib/session-lock.ts#L1-L42)

### 原子写入 (`writeFileAtomic`)

配置文件（settings.json 等）使用**临时文件 + rename** 保证原子性；Windows 下重试应对读者持锁导致的 `EPERM/EACCES`。

```typescript
const tmp = `${filePath}.tmp-${pid}-${random}`;
writeFileSync(tmp, data);
for (attempt = 1; ; attempt++) {
  try { renameSync(tmp, filePath); return; }
  catch (err) { if (!isRenameSharedConflict(err) || attempt >= MAX) throw; sleepSync(interval); }
}
```

**注意**：会话 `.jsonl` 文件**不使用** `writeFileAtomic`，而是由上游 `SessionManager` 以**追加模式**写入（`fs.appendFile`），依赖文件系统的追加原子性；重写（如 `session_info` 追加、分支头改写）在文件锁保护下全量覆盖。

Sources: [lib/atomic-write.ts](lib/atomic-write.ts#L1-L68), [app/api/sessions/[id]/route.ts](app/api/sessions/%5Bid%5D/route.ts#L100-L110)

---

## 常见问题与排查

| 现象 | 可能原因 | 定位方法 |
|------|----------|----------|
| 会话列表为空但文件存在 | 路径缓存负向条目未过期 | 等待 30s 或重启清空 `globalThis.__piSessionPathCacheState` |
| 分支创建后找不到父会话 | `parentSession` 存的是文件路径，父文件被删 | 检查 `session-cascade.ts` 重写逻辑，确认祖父路径正确传递 |
| 上下文投影缺失早期消息 | `context_edit` 省略了目标条目 | 检查 `buildSessionContext` 传入的 `leafId`，或查看 JSONL 中的 `context_edit` 链 |
| 导出 HTML 报错 ENOENT | 会话文件路径解析失败 | 确认 `resolveSessionPath` 返回有效路径，检查缓存同步 |
| 工具调用参数显示异常 | 上游格式变更（`arguments` vs `input`） | `normalizeToolCalls` 兼容 `toolCall.arguments` 与 `toolCall.input` |

Sources: [lib/session-path-cache.ts](lib/session-path-cache.ts#L1-L57), [lib/session-cascade.ts](lib/session-cascade.ts#L1-L54), [lib/normalize.ts](lib/normalize.ts#L1-L30)

---

## 相关页面导航

- **上一页**：[会话的两种访问模式：只读浏览与交互对话](9-hui-hua-de-liang-chong-fang-wen-mo-shi-zhi-du-liu-lan-yu-jiao-hu-dui-hua) — 理解只读浏览如何复用同一解析管线
- **下一页**：[四种会话分叉机制：Fork、会话内分支、跨文件 Branch、Clone](14-san-chong-fen-zhi-ji-zhi-fork-hui-hua-nei-fen-zhi-git-worktree-clone) — 深入分支操作的文件层面实现
- **关联**：[会话导出、AgentMode 持久化与级联删除](15-hui-hua-dao-chu-agentmode-chi-jiu-hua-yu-ji-lian-shan-chu) — 导出格式与删除时的级联重写细节