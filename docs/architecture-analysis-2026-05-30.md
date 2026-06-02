# 当前项目架构深度分析

日期：2026-05-30

## 结论摘要

当前项目的总体架构方向是合理的：它用 Next.js/React 作为统一 UI 层，同时支持浏览器开发模式和 Electron 桌面应用模式；后端通过 Next.js API routes 连接 Pi Agent 的 session 文件、运行态 AgentSession、模型配置、技能配置和文件浏览能力。

真正值得优化的地方不是推倒重来，而是收敛几个已经变重的中心模块，尤其是 `hooks/useAgentSession.ts`、`components/AppShell.tsx`、`lib/rpc-manager.ts`、`app/api/files/[...path]/route.ts` 和 `electron/main.ts`。这些文件现在承担了过多职责，后续继续加功能时容易产生状态竞争、职责不清和维护成本上升。

优先级最高的优化是：先拆 `hooks/useAgentSession.ts`，把 session 读取、SSE 事件、Agent 运行态、滚动副作用、统计计算等逻辑分离出来，但保持现有功能行为不变。

---

## 当前架构概览

### UI 层

主要入口是：

- `app/page.tsx`
- `components/AppShell.tsx`
- `components/ChatWindow.tsx`
- `hooks/useAgentSession.ts`

`AppShell` 是整体应用壳层，负责会话选择、URL 中的 `?session=` 状态、左右面板、文件 tabs、模型与技能弹窗、分支导航、系统提示词、token/cost 和 context usage 顶栏展示。

`ChatWindow` 是聊天区域的展示外壳，真正的会话加载、发送消息、SSE 连接、分支切换、fork、compact、模型切换和工具预设等逻辑主要委托给 `useAgentSession`。

### API 层

API 大致分为几类：

- `app/api/sessions/*`
  - 读取历史 session 文件
  - 构建 session tree
  - 返回指定 leaf 的 context

- `app/api/agent/*`
  - 创建新的 Agent session
  - 给已有 session 发送命令
  - 提供 SSE event stream
  - 查询运行态 Agent state

- `app/api/files/[...path]/route.ts`
  - 列目录
  - 读文件
  - 监听文件变化
  - 限制只能访问允许的 workspace roots

- `app/api/models*`
  - 读取和修改模型配置

- `app/api/skills*`
  - 技能列表、搜索和安装

- `app/api/auth*`
  - 认证 provider、API key、登录登出

### Session 读取层

主要文件：

- `lib/session-reader.ts`

它负责封装 Pi 的 `SessionManager`，包括：

- 列出所有 session
- 缓存 session id 到文件路径
- 构建 session tree
- 根据 leaf id 构建上下文
- 将 Pi 的 session context 转成 UI 使用的 `messages` 和 `entryIds`

这里的职责相对清楚，目前不是最需要优先重构的部分。

### Agent 运行态层

主要文件：

- `lib/rpc-manager.ts`

它包装 `@earendil-works/pi-coding-agent` 的 `AgentSession`，并通过 `globalThis.__piSessions` 和 `globalThis.__piStartLocks` 在 Next.js 热更新期间保留活跃 session 和并发启动锁。

它负责：

- 创建或恢复 AgentSession
- 管理活跃 session registry
- 订阅 Agent 事件
- 发送 prompt / abort / fork / compact / navigate_tree / set_model / set_tools 等命令
- 处理部分 Pi SDK 行为差异或 workaround

该文件是运行态核心，但现在 command dispatch、生命周期、registry、Pi workaround 都在一个文件里，后续会继续变重。

### Electron 层

主要文件：

- `electron/main.ts`

它负责：

- 查找可用端口
- 启动 Next.js dev server 或 packaged standalone server
- 创建 BrowserWindow
- 显示启动页
- 管理托盘
- 管理自动更新
- 注册 IPC
- 清理子进程

目前 Electron 主进程已经有部分模块拆分，例如 `tray`、`server-wait`、`process-tree`、`startup-failure`，但 `main.ts` 仍然承担较多 orchestration 和具体实现。

---

## 当前架构的优点

### 1. 产品边界清楚

项目目标明确：用一套 Next.js/React UI 同时支持浏览器开发模式和 Electron 桌面模式。这个方向适合当前产品形态，避免了维护两套 UI。

### 2. Session 与 Agent 运行态有基本分层

历史浏览走 `lib/session-reader.ts` 和 `/api/sessions/*`。

真正需要发送消息时才走 `/api/agent/*` 和 `lib/rpc-manager.ts`。

这个方向是对的，因为历史浏览不应该无故创建运行态 AgentSession。

### 3. Pi session 模型适配比较完整

项目已经考虑了：

- 独立 session 文件
- fork session
- 会话内 branch tree
- leaf context
- entryIds 和 UI messages 的平行映射
- compaction summary 的 UI 展示
- model / thinking level 状态

说明当前架构不是临时拼接，而是已经围绕 Pi 的真实 session 模型做过适配。

### 4. Electron 打包路径已经有明确经验沉淀

例如：

- 使用 Next.js standalone 输出
- packaged 模式用 `ELECTRON_RUN_AS_NODE=1` 启动 `server.js`
- `electron-builder.yml` 需要额外复制 standalone 的 `node_modules`

这些约束已经写入项目文档，降低了后续踩坑概率。

---

## 主要问题一：`useAgentSession.ts` 职责过重

这是当前最值得优先优化的部分。

`useAgentSession.ts` 现在同时负责：

1. 加载历史 session
2. 加载分支 context
3. 连接 SSE
4. 处理 Agent events
5. 发送新消息
6. 新 session 初始化
7. fork
8. navigate tree
9. compact
10. steer / follow up
11. abort
12. 切换模型
13. 切换 thinking level
14. 切换 tool preset
15. 加载模型列表
16. 加载工具列表
17. 管理 streaming 状态
18. 管理 agent phase
19. 计算 token/cost
20. 控制聊天滚动
21. 向 AppShell 上报 branch、system prompt、context usage 等状态

这导致它既是数据层，又是运行态层，又是 UI 副作用层。

### 风险

同一类状态存在多个来源：

- session 文件读取结果
- Agent runtime state
- SSE event
- React 本地 optimistic state

例如 `messages` 可能来自：

- `loadSession()`
- `loadContext()`
- `message_end` SSE event
- 发送消息时本地 optimistic append
- steer / follow_up 时本地 optimistic append
- agent_end 后重新加载 session

这容易产生：

- 消息重复
- 分支切换时短暂显示旧消息
- agent 结束后状态被回填覆盖
- compact 后 UI 和 session 文件不同步
- streaming 状态卡住
- tool running 状态没有正确清理

### 建议

先做低风险拆分，不改变对外行为。

建议拆成：

- `hooks/agent-session/session-stats.ts`
  - 计算 token/cost

- `hooks/agent-session/stream-state.ts`
  - 管理 streaming reducer

- `hooks/agent-session/agent-phase.ts`
  - 管理 waiting_model / running_tools 状态

- `hooks/agent-session/use-chat-scroll.ts`
  - 管理聊天滚动 refs 和滚动 effect

- `hooks/agent-session/use-session-loader.ts`
  - 管理 session/context 读取

- `hooks/agent-session/use-agent-events.ts`
  - 管理 EventSource 连接与重连

`useAgentSession.ts` 继续作为 `ChatWindow` 的对外入口，但从“所有逻辑都亲自做”变成“组合各个小模块”。

### 预期效果

- `useAgentSession.ts` 更薄
- 状态来源更清楚
- 纯逻辑可测试
- 后续排查 bug 更容易定位
- 后续引入明确状态机更安全

---

## 主要问题二：`AppShell.tsx` 承担过多 UI 编排职责

`AppShell.tsx` 当前负责：

- session 选择
- 新 session cwd
- URL restore
- cwd 切换
- sessionKey 强制重挂载
- sidebar 开关
- panel resize
- right file panel
- file tabs
- branch navigator state
- system prompt top panel
- token/cost/context usage top bar
- models config 弹窗
- skills config 弹窗
- keyboard shortcut

这使它成为一个大型 UI orchestration 组件。

### 风险

`selectedSession`、`newSessionCwd`、`activeCwd`、`sessionKey`、`initialSessionRestored`、`suppressCwdBumpRef` 等状态相互影响。

为了避免重复 remount、router replace、Suspense loop，组件中已经出现了保护性逻辑。这说明状态协调复杂度已经比较高。

### 建议

后续可以拆成几个小 hook：

- `useSessionSelection`
  - 管理 selectedSession、newSessionCwd、activeCwd、URL restore

- `usePanelLayout`
  - 管理 sidebar、right panel、panel widths、resize

- `useFileTabs`
  - 管理 file tabs 和 active tab

- `useTopBarSessionMeta`
  - 管理 branch tree、system prompt、session stats、context usage

`AppShell` 最终只负责组合布局。

### 预期效果

- UI 编排更清晰
- 新增顶部栏、侧边栏、文件面板功能时不容易互相影响
- session 切换相关 bug 更容易定位

---

## 主要问题三：`/api/agent/[id]/events` 的 GET 有隐式副作用

当前 SSE route 的行为是：

如果运行态 session 不存在，GET `/api/agent/[id]/events` 会尝试通过 session 文件启动一个新的 AgentSession。

这意味着一个 GET 请求不仅是读取事件流，还可能创建运行态 Agent。

### 风险

这和项目中“只读浏览历史不要创建 AgentSession”的原则有语义张力。

虽然当前前端可能只在需要时连接 events，但 API 本身的语义并不干净：

- 读事件流会隐式启动 runtime
- SSE 重连可能触发启动路径
- 后续多窗口、多进程或资源释放时边界不清晰

### 建议

后续可以新增显式 attach API：

```text
POST /api/agent/[id]/attach
```

用于启动或恢复运行态 AgentSession。

然后让：

```text
GET /api/agent/[id]/events
```

只连接已有 runtime。如果 runtime 不存在，返回 404 或 running false。

### 预期效果

- API 读写语义更清楚
- 只读历史浏览和运行态 Agent 生命周期分离
- 后续做多窗口或更严格资源管理更容易

---

## 主要问题四：`rpc-manager.ts` 是运行态核心，但职责太集中

`rpc-manager.ts` 当前包含：

- `AgentSessionWrapper`
- event listener 管理
- idle timer
- destroy lifecycle
- command switch
- prompt / abort / fork / compact / navigate / set_model / set_tools 等命令处理
- Pi SDK workaround
- global registry
- start locks
- startRpcSession
- session path cache 写入

### 风险

它会随着 Pi SDK 能力和产品功能增长继续膨胀。

特别是 command switch 里已经包含：

- fork 的 session 文件处理
- compact 的预检查 workaround
- thinking level 的 DeepSeek 兼容逻辑
- tools active 状态设置

这些逻辑都合理，但混在一个文件中会降低可维护性。

### 建议

后续可以拆成：

```text
lib/agent-runtime/
├─ registry.ts
├─ wrapper.ts
├─ commands.ts
├─ start-session.ts
├─ fork-session.ts
├─ compact-session.ts
└─ types.ts
```

外部仍然只暴露：

```ts
getRpcSession
startRpcSession
```

### 预期效果

- 运行态生命周期和命令适配分离
- Pi SDK workaround 有明确位置
- 后续升级 Pi SDK 或增加命令时风险更低

---

## 主要问题五：文件访问权限依赖 session/cwd 缓存

`app/api/files/[...path]/route.ts` 当前通过 allowed roots 限制文件访问。

allowed roots 来源包括：

- 所有历史 session 的 cwd
- `~/pi-cwd-*`
- 新 session 创建后手动加入 `globalThis.__piAllowedRootsCache`

### 优点

这避免了 API 任意读全盘，是必要的安全边界。

### 问题

权限模型和 session 历史耦合较强：

```text
能不能读某目录 ≈ 是否曾经存在该 cwd 的 session
```

这会导致：

- 新 cwd 要靠 `agent/new` 手动同步缓存
- 文件 API 需要知道 session 列表
- 如果未来支持“打开目录但不创建会话”，模型会变别扭
- 多窗口或 Electron/Web 混合时 allowed roots 生命周期不够清晰

### 建议

抽出独立 workspace 权限模型：

```text
lib/workspaces.ts
```

提供：

```ts
listAllowedWorkspaces()
allowWorkspace(cwd)
isPathInAllowedWorkspace(path)
refreshFromSessions()
```

让 `/api/files` 只依赖 workspace 层，而不是直接依赖 session 列表。

### 预期效果

- 文件访问权限边界更清楚
- session 和文件浏览解耦
- 后续支持“打开目录”“最近 workspace”“多窗口”更自然

---

## 主要问题六：`electron/main.ts` 仍然偏重

`electron/main.ts` 负责：

- logging
- port finding
- Next.js server lifecycle
- startup page
- BrowserWindow
- IPC
- tray
- auto updater
- cleanup
- app lifecycle

虽然已经拆出了一些模块，但主文件仍然承担大量具体实现。

### 建议

后续拆成：

```text
electron/
├─ main.ts
├─ logging.ts
├─ port.ts
├─ next-server.ts
├─ main-window.ts
├─ ipc.ts
├─ updater.ts
└─ startup-page.ts
```

优先拆：

1. `next-server.ts`
2. `main-window.ts`
3. `logging.ts`
4. `ipc.ts`

### 预期效果

- Electron 主流程更清晰
- 自动更新、启动失败、托盘、窗口行为更容易独立修改
- 桌面端启动问题更容易定位

---

## 核心架构问题：状态源太多

当前 session 和聊天状态主要来自四个地方：

```text
Pi session file
↓
lib/session-reader.ts
↓
/api/sessions/[id]
```

```text
AgentSession runtime
↓
lib/rpc-manager.ts
↓
/api/agent/[id]
```

```text
SSE events
↓
/api/agent/[id]/events
```

```text
React optimistic state
↓
useAgentSession.ts
```

这些来源都会影响 UI 中的：

- messages
- entryIds
- activeLeafId
- agentRunning
- streamState
- thinkingLevel
- model
- contextUsage
- systemPrompt
- sessionStats

长期看，需要把状态分成三类：

### 1. Persisted Session State

来自 `.jsonl` session 文件。

包括：

- messages
- entryIds
- tree
- leafId
- 历史 model
- 历史 thinking level

### 2. Runtime Agent State

来自活跃 AgentSession。

包括：

- running
- streaming
- compacting
- contextUsage
- systemPrompt
- active tools
- current model

### 3. Local UI State

只属于界面。

包括：

- panel width
- selected file tab
- scroll refs
- dropdown open state
- modal open state

理想方向是：

```text
Persisted state 由 session-reader 管
Runtime state 由 agent-runtime 管
Local UI state 留在 React 组件或 UI hooks
```

当前最大的问题是 `useAgentSession.ts` 同时混合了这三类状态。

---

## 推荐优化路线

### 第一阶段：拆 `useAgentSession.ts`

这是最高优先级。

目标：

- 不改功能
- 不改 `ChatWindow` 调用契约
- 不改 API
- 只拆内部职责

建议拆出：

- `session-stats.ts`
- `stream-state.ts`
- `agent-phase.ts`
- `use-chat-scroll.ts`
- `use-session-loader.ts`
- `use-agent-events.ts`

效果：

- 主 hook 变薄
- 状态来源更明确
- 纯逻辑可测试
- 后续 bug 更容易定位

对应计划已保存到：

```text
docs/superpowers/plans/2026-05-30-use-agent-session-refactor.md
```

### 第二阶段：拆 `AppShell.tsx`

目标：把 session 选择、panel layout、file tabs、topbar meta 拆成独立 hook。

效果：

- UI 状态更清楚
- session 切换和 layout 互不干扰

### 第三阶段：清理 Agent API 语义

目标：把 runtime attach 和 SSE listen 分开。

建议：

- 新增 `POST /api/agent/[id]/attach`
- 让 `GET /api/agent/[id]/events` 不再隐式启动 AgentSession

效果：

- 读写边界更清晰
- 只读历史浏览更安全

### 第四阶段：拆 `rpc-manager.ts`

目标：把 registry、wrapper、command handlers、start session、fork、compact 分开。

效果：

- 运行态核心更可维护
- Pi SDK workaround 不再散在大 switch 中

### 第五阶段：抽象 workspace 权限模型

目标：让文件访问权限不直接依赖 session 列表。

效果：

- 文件浏览和 session 解耦
- 后续支持打开目录、多 workspace 更容易

### 第六阶段：拆 Electron 主进程

目标：把 logging、server lifecycle、window、IPC、updater 分开。

效果：

- Electron 启动和打包问题更容易定位
- 桌面端功能继续增加时不会让 `main.ts` 失控

---

## 暂时不建议做的事

### 1. 不建议马上引入 Zustand / Redux

当前问题不是缺状态管理库，而是状态边界不清楚。

应先拆清楚 persisted state、runtime state 和 UI state，再考虑是否需要外部状态库。

### 2. 不建议把 Next.js API 全部换成 Electron IPC

当前复用 Web/Electron 的策略是优势。

只有真正桌面专属的能力才应该走 preload / IPC。

### 3. 不建议重写 session-reader

`lib/session-reader.ts` 虽然有复杂细节，但职责相对明确。

它不是当前最大风险点。

### 4. 不建议引入数据库

当前 Pi session 文件是事实数据源。

除非未来需要全文索引、多设备同步、大规模历史缓存，否则数据库会增加复杂度。

---

## 最终判断

当前项目已经进入“功能跑通，但核心模块开始膨胀”的阶段。

现在最重要的不是大规模重构，而是按风险顺序做渐进式整理。

最优先的工作是：

```text
拆 useAgentSession.ts
```

因为它连接了：

- UI
- session 文件
- API
- SSE
- Agent runtime
- optimistic message state
- scroll side effects

它是最容易产生用户可见 bug 的地方。

完成这一轮后，项目会获得三个直接收益：

1. 功能行为保持不变，但代码结构更清楚。
2. 出问题时更容易定位到具体模块。
3. 后续继续优化 AppShell、rpc-manager、API 语义和 Electron 主进程时风险更低。
