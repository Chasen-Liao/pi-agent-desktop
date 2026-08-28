# Issue #20：对话进行当中突然白屏的机制分析

> 调研日期：2026-08-28
> 落地更新：本报告 §4 建议的方向 1/2（全局错误边界、`render-process-gone` 自动重载）已于同日实现（`app/error.tsx`、`electron/crash-recovery.ts`，见 [ARCHITECTURE.md §14.16](../ARCHITECTURE.md#1416-白屏双兑底全局错误边界与渲染进程崩溃自动重载2026-08-28issue-20)）；方向 3/4（`MessageView` content 防御、pi-ai 升级）未做。正文保留调研时点视角。
> 范围：GitHub issue #20 原文核实、issue 创建时可能的版本（v0.8.3，当前 v0.8.4 / HEAD `fe21e23`）、前端渲染链路（`app/`、`components/`、`hooks/`）、SSE 服务端链路（`app/api/agent/[id]/events`、`lib/rpc-manager.ts`）、Electron 主进程（`electron/main.ts`）、`node_modules` 中 Pi SDK（`@earendil-works/pi-coding-agent` / `@earendil-works/pi-ai` 0.84.3）源码、上游 `earendil-works/pi`（原 `badlogic/pi-mono` 重定向）issue 检索、React / Next.js / Electron 官方文档
> 结论性质：静态分析 + 上游关联；未在报告者机器上复现，未取得其任何日志、截图或版本号。所有根因排序均为假设，证据等级逐条标注。

## 结论先行

**Issue #20 的正文为空、无评论、无标签、无版本号、无日志、无截图、无复现步骤——信息量为零。** 因此本报告不可能"确认"根因，只能做两件事：把"白屏"这个症状在本项目的架构里穷举为有限的几类机制，然后逐类核对代码证据并排序。

核对结果是清晰的：**本项目存在两个与"突然白屏"症状精确吻合、且都已被代码证实的结构性缺口**——

1. **全仓库没有任何 React 错误边界。** `app/` 下没有 `error.tsx` / `global-error.tsx`（完整目录清单见 §2.1），全代码库无 `ErrorBoundary` / `componentDidCatch` / `getDerivedStateFromError`。React 官方明确：默认情况下，未捕获的渲染期异常会让 React 在下一次渲染时**移除整棵组件树**（[React 官方文档](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)）。任何一条 SSE 事件驱动的 re-render 中抛出的异常，都会让 `BrowserWindow` 只剩空 DOM——即白屏。
2. **Electron 主进程没有任何渲染进程崩溃处理。** `electron/main.ts`（全 673 行）没有监听 `render-process-gone` / `did-fail-load`（运行期）/ `unresponsive`，也没有 `crashReporter`。渲染进程因 OOM 或 GPU 崩溃后，窗口将**永久保持空白**，用户唯一的自救是重启应用（[Electron `render-process-gone` 事件](https://www.electronjs.org/docs/latest/api/web-contents#event-render-process-gone)）。

在这两个放大器之上，"对话进行当中"这个限定词指向的具体触发路径按证据排序为：**渲染期异常 × 无错误边界（中强）≥ 渲染进程崩溃 × 无恢复处理（中强）> 上游 pi-ai 0.84.3 事件循环 O(n²) 冻结（作为白屏解释为弱/中，作为"对话中稳定性"缺陷为实锤）**。SSE 断连、Next 服务崩溃、wrapper 空闲销毁等路径都有现成兜底 UI（红条重连、启动页自动重启），不产生白屏，基本可排除（§3.4）。

另有一个与白屏无直接关系、但调研中实锤的上游缺陷必须记录：**本仓库安装的 `@earendil-works/pi-ai` 0.84.3 含有上游 issue [#8648](https://github.com/earendil-works/pi/issues/8648) 报告的 O(n²) reasoning_details 累积代码**（本地文件逐行吻合，见 §3.3），且 0.84.3 目前仍是 npm 最新版、无修复版可升级。它会冻结 Next.js 服务进程的事件循环，症状是"卡住"而非"白屏"。

## 证据等级

| 等级 | 判断 | 依据 |
|---|---|---|
| 强 | 仓库无任何 React 错误边界；渲染期未捕获异常会导致整棵树卸载并呈现白屏 | [`app/` 目录清单（无 error.tsx / global-error.tsx）](../../app)、全库 grep 无 `componentDidCatch`/`getDerivedStateFromError`/`ErrorBoundary`（本次调研执行，命令见 §5）、[React 官方文档](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)、[Next.js error.tsx 约定](https://nextjs.org/docs/app/api-reference/file-conventions/error) |
| 强 | Electron 主进程无渲染进程崩溃/失响应处理；崩溃后窗口永久空白 | [`electron/main.ts`](../../electron/main.ts) 全文无 `render-process-gone`/`did-fail-load`（运行期）/`unresponsive` 监听、无 `crashReporter`；[Electron 官方事件文档](https://www.electronjs.org/docs/latest/api/web-contents#event-render-process-gone) |
| 强 | 安装的 pi-ai 0.84.3 含上游 #8648 报告的 O(n²) reasoning_details 累积代码，且 0.84.3 是 npm 最新版（无修复版） | [`node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:441-453`](../../node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js#L441-L453)、[上游 issue #8648](https://github.com/earendil-works/pi/issues/8648)、`npm view @earendil-works/pi-ai versions`（本次执行，0.84.3 为末项） |
| 中强 | issue #20 的白屏最可能是"渲染期异常 × 无错误边界"或"渲染进程崩溃 × 无恢复处理"两者之一 | 症状（"对话中突然白屏"）与两个机制的表现精确吻合；但 issue 无日志/版本/复现，具体触发未知，无法在两者间裁决 |
| 中 | SSE 断连 / Next 服务崩溃 / wrapper 空闲销毁**不是**白屏根因 | [重连与红条 UI：`agent-events-manager.ts:143-160`](../../hooks/agent-session/agent-events-manager.ts#L143-L160)、[`ChatWindow.tsx:264`](../../components/ChatWindow.tsx#L264)；[服务崩溃自动重启：`main.ts:226-249`](../../electron/main.ts#L226-L249)；[wrapper 空闲销毁只停事件：`rpc-manager.ts:244-248`](../../lib/rpc-manager.ts#L244-L248) |
| 弱 | 特定第三方解析（react-markdown / Prism）对特异输入抛错是直接触发因素 | react-syntax-highlighter 对未知语言有内部 try/catch 兜底（[`highlight.js:280-290`](../../node_modules/react-syntax-highlighter/dist/cjs/highlight.js#L280-L290)），该子假设被削弱；未定位到与本仓库版本（react-markdown 10.1.0 / refractor 5）对应的已知崩溃 issue |
| 弱 / 未证实 | 报告者使用的是 v0.8.3 | issue 创建于 2026-08-28 10:19（UTC+8），早于 v0.8.4 发布（同日 13:38，提交 [`faa0099`](https://github.com/Chasen-Liao/pi-agent-desktop/commit/faa0099)）约 3.3 小时、晚于 v0.8.3 发布（2026-08-27 16:50，[Release](https://github.com/Chasen-Liao/pi-agent-desktop/releases/tag/v0.8.3)）约 17.5 小时；时间上 v0.8.3 概率最大，但 issue 未写版本 |

## §0 Issue 概览（#9 / #14 / #16 / #18 / #19 / #20 / #21）

以下状态与评论数经 `gh issue view` 逐一核实（2026-08-28）；修复 commit 来自 `git log` 对照，commit 号均带 GitHub 链接。

| Issue | 状态 | 创建日期 | 主题 | 对应修复 commit | 类别 |
|---|---|---|---|---|---|
| [#9](https://github.com/Chasen-Liao/pi-agent-desktop/issues/9) 软件打开一直卡在初始页面放圈圈 | CLOSED | 2026-07-31 | 安装后卡启动页 | [`44bedcc`](https://github.com/Chasen-Liao/pi-agent-desktop/commit/44bedcc82d5bf344880655dd2f9dcafc5345dec6)（v0.7.19 补拷 turbopack runtime）+ [`01281fd`](https://github.com/Chasen-Liao/pi-agent-desktop/commit/01281fd)（v0.7.21 启动导航有界重试） | 打包/启动 |
| [#14](https://github.com/Chasen-Liao/pi-agent-desktop/issues/14) v0.8.0 returns HTTP 500 when Pi runtime files are missing | CLOSED | 2026-08-25 | 打包漏 Pi runtime 致 500 | [`32e0dfe`](https://github.com/Chasen-Liao/pi-agent-desktop/commit/32e0dfe)（v0.8.1 恢复 Pi runtime，PR #15） | 打包/启动 |
| [#16](https://github.com/Chasen-Liao/pi-agent-desktop/issues/16) "bug"（正文实为"能不能添加中文语言"） | **OPEN** | 2026-08-25 | 中文界面功能请求 | 无（维护者评论"可以的🤗"，尚无实现 commit） | 功能 |
| [#18](https://github.com/Chasen-Liao/pi-agent-desktop/issues/18) 不支持拖拽上传文件 | CLOSED | 2026-08-26 | 拖拽文件进对话 | [`84d1e18`](https://github.com/Chasen-Liao/pi-agent-desktop/commit/84d1e18)（feat: drag any file into chat as @path mention） | 功能 |
| [#19](https://github.com/Chasen-Liao/pi-agent-desktop/issues/19) 关于win安装包的小问题 | CLOSED | 2026-08-26 | 安装目录子文件夹提示 | [`83392d8`](https://github.com/Chasen-Liao/pi-agent-desktop/commit/83392d8)（fix(installer)，同日随 v0.8.4 发布） | 打包/启动 |
| [#20](https://github.com/Chasen-Liao/pi-agent-desktop/issues/20) 对话进行当中总是突然白屏 | **OPEN** | 2026-08-28 | 对话中白屏（本报告对象） | 无任何修复 | 稳定性 |
| [#21](https://github.com/Chasen-Liao/pi-agent-desktop/issues/21) Provider只能有一个吗…save之后也不会显示 | CLOSED | 2026-08-28 | Provider API Key 持久化 | [`e4a66f3`](https://github.com/Chasen-Liao/pi-agent-desktop/commit/e4a66f3)（fix: persist provider API keys to auth.json） | 配置 |

**主题归纳**：7 个 issue 分为四类——打包/启动类（#9、#14、#19，全部已修复）、功能类（#16、#18，#18 已实现、#16 为待实现请求）、配置类（#21，已修复）、稳定性类（#20）。**当前仍 Open 的只有 #16（功能请求）和 #20；#20 是唯一未解决的稳定性问题**，且没有任何评论跟进、没有对应的修复分支或 commit。

## 1. Issue 实际提供了什么

### 1.1 已确认事实（`gh issue view 20 --json author,body,comments,createdAt,state,title` 输出原文）

```json
{"author":{"login":"qinzq96-design"},"body":"","comments":[],
 "createdAt":"2026-08-28T02:19:37Z","state":"OPEN","title":"对话进行当中总是突然白屏"}
```

- 标题给出唯一症状：**对话进行当中**（排除了启动阶段）**总是**（复现频率高，非偶发）**突然白屏**（无过渡、无错误页）。
- 作者 `qinzq96-design`（非 bot，非维护者）。
- 正文为空；0 评论；无标签、无负责人、无关联 PR；状态 OPEN。
- 时间定位：创建于 2026-08-28 10:19（UTC+8）。v0.8.4 于同日 13:38 发布（[`faa0099`](https://github.com/Chasen-Liao/pi-agent-desktop/commit/faa0099)），v0.8.3 于前一日 16:50 发布（[Release](https://github.com/Chasen-Liao/pi-agent-desktop/releases/tag/v0.8.3)）。报告者**极可能使用 v0.8.3**，但不能证明。

### 1.2 因此仍未知（每一项都可能推翻本报告的排序）

- 使用模式：桌面（Electron 安装包）还是 Web 浏览器访问？——**未知**。这直接决定候选机制池（渲染进程崩溃只在桌面模式存在）。
- 应用版本、Windows/浏览器版本——未知。
- 模型与 Provider（是否为带 reasoning/thinking 的推理模型、是否走 OpenAI-compatible 中转）——未知。这决定 §3.3 上游 O(n²) 路径是否可能被触发。
- "总是"的频率与触发条件：每轮必现？长会话才现？特定操作（工具调用、长输出、compact）后现？——未知。
- 白屏后的状态：窗口是否还能响应？任务管理器里渲染进程是否存活？刷新/Ctrl+R 能否恢复？——未知。这一项是裁决 §3.1（进程存活、DOM 空）与 §3.2（进程死亡）的**关键判据**。
- 是否出现过错误横幅（"连接已彻底中断"）或"正在重新启动本地服务"启动页——未知。出现过则分别指向已兜底路径而非白屏。

## 2. 白屏的两个结构性缺口（已证实事实）

### 2.1 缺口一：无任何 React 错误边界

- **`app/` 目录全部内容**：`api/`、`favicon.ico`、`globals.css`、`layout.tsx`、`page.tsx`。没有 `error.tsx`、没有 `global-error.tsx`（App Router 的两层错误 UI 约定文件，[Next.js 官方文档](https://nextjs.org/docs/app/api-reference/file-conventions/error)）。
- 全仓库（`app/ components/ hooks/ lib/ electron/`）grep `componentDidCatch|ErrorBoundary|getDerivedStateFromError`：**零命中**（本次调研执行）。
- 根页面 [`app/page.tsx:1-10`](../../app/page.tsx#L1-L10) 仅 `<Suspense><AppShell /></Suspense>`；根布局 [`app/layout.tsx`](../../app/layout.tsx) 仅字体/主题/CSP 脚本，无错误 UI。
- React 官方行为：*"By default, when an uncaught error is thrown, React will remove the whole React component tree on the next render."*（[Error Boundary 文档](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)）。Next.js App Router 生产构建下没有 dev overlay 兜底，没有 `error.tsx` 时错误直接冒泡到根，页面呈空白。

**推论（机制层面，强）**：渲染期任何未捕获异常 → React 卸载整棵树 → `<body>` 内 DOM 清空 → Electron `BrowserWindow` 只剩背景色 → **白屏**，且不会自行恢复（无任何代码会重新挂载或导航）。这与"突然白屏"的表观症状精确一致。

### 2.2 缺口二：渲染进程死亡无检测、无恢复

- [`electron/main.ts`](../../electron/main.ts) 全文监听的窗口/进程事件仅：`close`、`closed`、`ready-to-show`、`will-navigate`、`setWindowOpenHandler`，以及 Next 子进程的 `exit`/`error`（[`main.ts:166`](../../electron/main.ts#L166)、[`main.ts:188`](../../electron/main.ts#L188)）。
- **没有** `webContents.on("render-process-gone")`、没有运行期 `did-fail-load`、没有 `"unresponsive"`、没有 `crashReporter`（全 `electron/` 目录 grep 证实）。
- Electron 官方：`render-process-gone` 在渲染进程崩溃或被杀时发出，`details.reason` 可区分 `oom`/`crashed` 等（[文档](https://www.electronjs.org/docs/latest/api/web-contents#event-render-process-gone)）；不处理该事件的典型后果就是窗口保持空白。Electron 43（本仓库 devDependency `electron: ^43.4.1`，[`package.json:47`](../../package.json#L47)）行为一致。
- 桌面模式下窗口加载 `http://127.0.0.1:<port>`（[`main.ts` `showApp()`](../../electron/main.ts)），渲染进程崩溃后 Next 服务仍在运行、`.jsonl` 会话文件完好——用户重启应用后对话**可以找回**，但当时的白屏体验与"数据是否丢失"无关。

**推论（机制层面，强）**：渲染进程一旦 OOM/GPU 崩溃，窗口**永久白屏**。注意桌面模式与 Web 模式在此分叉：Web 模式下浏览器标签页崩溃会显示 Chromium 自己的"喔唷，崩溃啦"页，而**不是白屏**；因此若报告者是桌面用户，此机制优先级上升。

## 3. "对话进行当中"的候选机制：证据与排序

### 3.1 候选一：SSE 驱动的渲染期异常 × 无错误边界（中强）

**完整链路**：`AgentSessionWrapper` 转发 pi 事件（[`rpc-manager.ts:167-191`](../../lib/rpc-manager.ts#L167-L191)）→ SSE 路由转发（[`events/route.ts:97`](../../app/api/agent/[id]/events/route.ts#L97)）→ 前端 `EventSource.onmessage` JSON.parse 后进入事件处理（[`agent-events-manager.ts:135-141`](../../hooks/agent-session/agent-events-manager.ts#L135-L141)）→ `applyAgentEvent` 生成 state 补丁（[`agent-event-apply.ts:109-143`](../../hooks/agent-session/agent-event-apply.ts#L109-L143)）→ `handleAgentEvent` 里的 `dispatch`/`setMessages`（[`useAgentSession.ts:295-380`](../../hooks/useAgentSession.ts#L295-L380)）→ ChatWindow 重渲染 → MessageList → MessageView。

**已经做了防御的环节（逐一核对，均有源码）**：

- `normalizeToolCalls` 对缺失字段返回空串、对非数组 content 原样透传（[`lib/normalize.ts:21-24`](../../lib/normalize.ts#L21-L24)，配套 [`normalize.test.ts`](../../lib/normalize.test.ts) 14 个用例）；在 SSE 路径（[`agent-event-apply.ts:117`](../../hooks/agent-session/agent-event-apply.ts#L117)、[`agent-event-apply.ts:131`](../../hooks/agent-session/agent-event-apply.ts#L131)）与 .jsonl 加载路径（[`session-reader.ts:247`](../../lib/session-reader.ts#L247)）双处生效。
- SSE JSON 解析失败被 try/catch 捕获仅记 console（[`agent-events-manager.ts:135-141`](../../hooks/agent-session/agent-events-manager.ts#L135-L141)）——**不会**进入 render 路径。
- `AgentSessionWrapper.emitEvent` 对每个 listener 有 try/catch（[`rpc-manager.ts:94-101`](../../lib/rpc-manager.ts#L94-L101)），SSE 路由的 `encode` 抛错（如 controller 已关闭）不会击穿服务进程。
- `AssistantMessageView` 的 `blocks = message.content ?? []`（[`MessageView.tsx:376`](../../components/MessageView.tsx#L376)）；`BlockView` 对未知 block 返回 `null`（[`MessageView.tsx:607-623`](../../components/MessageView.tsx#L607-L623)）；`getToolPreview` 对非 object input 返回空串（[`MessageView.tsx:802-814`](../../components/MessageView.tsx#L802-L814)）。
- Prism 语法高亮对**未知代码围栏语言**不会崩：react-syntax-highlighter 的 `getCodeTree` 把 `refractor.highlight` 包在 try/catch 里、失败回退纯文本（[`dist/cjs/highlight.js:280-290`](../../node_modules/react-syntax-highlighter/dist/cjs/highlight.js#L280-L290)）。**该子假设被此证据降级。**

**仍无防御、最可能在"对话中"抛错的渲染点（事实性缺口）**：

1. [`MessageView.tsx:140-145`](../../components/MessageView.tsx#L140-L145)（CustomMessageView）与 [`MessageView.tsx:196-201`](../../components/MessageView.tsx#L196-L201)（UserMessageView）：`typeof message.content === "string" ? message.content : message.content.filter(...)`——若 SSE `message_end`（user 消息）携带 `content: undefined` 或非字符串非数组形状，`.filter` 调用直接 `TypeError`。`message_end` 事件经 [`agent-event-apply.ts:128-134`](../../hooks/agent-session/agent-event-apply.ts#L128-L134) 进入 `appendMessages`，**未经过** `normalizeToolCalls` 的 assistant-only 归一化（它对 user 消息原样透传），也没有任何形状校验。
2. [`MessageView.tsx:206-208`](../../components/MessageView.tsx#L206-L208)：imageBlocks 过滤同样假定 content 为数组。
3. ReactMarkdown 10.1.0 + remark-gfm 4.0.1 对特异 markdown 输入的解析崩溃：本次未定位到与本仓库版本对应的已知上游 issue，**降级为弱**，不作为独立依据。

**排序理由**：机制（异常 → 整树卸载 → 白屏）为强证据；但"什么样的真实事件载荷能触发上述 `TypeError`"取决于 pi-ai 各 Provider 返回的消息形状，报告者未提供模型/Provider，无法证实触发输入。故整体定中强。

### 3.2 候选二：渲染进程资源耗尽/崩溃 × 无恢复处理（中强）

**渲染层每 SSE chunk 的工作量（均源码可证）**：

- 每条 `message_update` 都生成新 `streamingMessage` 对象（[`stream-state.ts:23`](../../hooks/agent-session/stream-state.ts#L23)），而 `MessageList` 的 `React.memo` 因 `streamingMessage` 与 `activeAgentIndicator`（每次渲染新建的 element，[`ChatWindow.tsx:344-346`](../../components/ChatWindow.tsx#L344-L346)）props 身份变化而**每次都失效**（[`MessageList.tsx:26`](../../components/MessageList.tsx#L26)）——整列表 reconcile 每个 chunk 执行一次。列表内部的单条 `MessageView` 有 memo，旧消息 props 引用稳定时可跳过，但长会话下每 chunk 的固定开销仍是 O(列表长)。
- [`ChatWindow.tsx:148-151`](../../components/ChatWindow.tsx#L148-L151) 的 `splitActiveThinking(streamState.streamingMessage)` 每 chunk 对**已累积的全部** thinking 文本做 filter/map/join——单轮流式期间为 O(n²) 字符处理（[`lib/active-thinking.ts:5-19`](../../lib/active-thinking.ts#L5-L19)）。
- `AssistantMessageView` 流式时的预估 token IIFE 每 chunk 重算全部 content 长度（[`MessageView.tsx:494-503`](../../components/MessageView.tsx#L494-L503)），同为 O(n²)/turn。

**服务端放大因素（每轮 agent_end 一次）**：

- `agent_end` 触发 `reloadSession`（[`agent-event-apply.ts:75-77`](../../hooks/agent-session/agent-event-apply.ts#L75-L77)）→ `GET /api/sessions/[id]` → [`getSessionEntriesAsync`](../../lib/session-reader.ts#L263-L289) 对整个 `.jsonl` `readFile` + `split("\n")` 全量载入解析，再 `buildTree` + `buildSessionContext` + `listAllSessions()`（全目录扫描，[`session-reader.ts:44-71`](../../lib/session-reader.ts#L44-L71)）。含大量工具输出的长会话文件每轮结束都被完整重读一次（无逐行流式、无增量）。
- 前端 `messages` 数组随会话单调增长，无上限；`agent_end` 全量替换时新旧数组瞬时并存（双倍峰值）；`calculateSessionStats(messages)` 每次全量重算（[`useAgentSession.ts:246`](../../hooks/useAgentSession.ts#L246)）。

**排序理由**：内存与 CPU 随会话长度增长是事实，Electron 渲染进程 OOM 崩溃后永久白屏也是事实（§2.2）；但"增长速率足以在报告者的会话长度内触发崩溃"没有任何实测数据（无报告者会话规模、无崩溃转储），机制成立而触发证据缺失，定中强（桌面模式）/中（Web 模式不适用）。

### 3.3 候选三：上游 pi-ai 0.84.3 事件循环 O(n²) 冻结（实锤存在；作为白屏解释为弱）

- **上游 issue**：[earendil-works/pi #8648](https://github.com/earendil-works/pi/issues/8648)"@earendil-works/pi-ai: O(n²) reasoning_details accumulation freezes the event loop"，明确报告于 **pi-ai 0.84.3**：每个流式 reasoning_detail chunk 都重新 parse 整个已累积的 `block.thinkingSignature` JSON、push 一项、再重新 stringify 整个数组——同步 O(n²) 循环卡死事件循环，"进程冻结数十秒"。
- **本地实锤**：本仓库 `node_modules/@earendil-works/pi-ai` 版本 0.84.3（`package.json` 与 `npm view` 双重确认），其 [`dist/api/openai-completions.js:441-453`](../../node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js#L441-L453) 与 issue 引用代码逐行吻合（`const preservedDetails = parseOpenAIReasoningDetails(block.thinkingSignature) ?? []; preservedDetails.push(detail); block.thinkingSignature = JSON.stringify(preservedDetails);`）。
- **无修复版**：`npm view @earendil-works/pi-ai versions` 最新即 0.84.3；上游 issue 于 2026-08-26 关闭，但属于新贡献者 auto-close 流程，维护者仅回复"thanks for flagging"，**没有任何已修复声明或修复版本**。
- **触发条件**：OpenAI-completions 兼容通道 + 流式返回 `reasoning_details`（典型：OpenRouter 推理模型）。报告者是否此场景——未知。
- **症状匹配**：该缺陷冻结的是 **Next.js 服务进程**（AgentSession 运行在服务端，[`rpc-manager.ts:377-455`](../../lib/rpc-manager.ts#L377-L455)），表现应为 UI 长时间停在等待态、SSE 停摆，**而非白屏**。因此它对"白屏"的解释力弱；但它精确命中"对话进行当中突然出问题"的稳定性主题，且是当前依赖树里唯一已知的上游活性缺陷，建议一并处理（升级或 patch-package）。

### 3.4 已有兜底、可基本排除的白屏候选

| 候选路径 | 现有兜底（源码） | 预期症状（非白屏） |
|---|---|---|
| SSE 断连 / 反复重连失败 | `onerror` 指数退避重试 5 次后转 `failed`（[`agent-events-manager.ts:143-160`](../../hooks/agent-session/agent-events-manager.ts#L143-L160)）→ 红色横幅 + 手动重连按钮（[`ChatWindow.tsx:264-282`](../../components/ChatWindow.tsx#L264-L282)） | 顶部红条，界面仍在 |
| SSE 单条事件 JSON 损坏 | `onmessage` try/catch（[`agent-events-manager.ts:135-141`](../../hooks/agent-session/agent-events-manager.ts#L135-L141)） | 仅 console 报错 |
| Next.js 服务进程崩溃 | `handleNextProcessExit` → `restartNextServer` → 启动页"正在重新启动本地服务"→ 重载应用（[`main.ts:226-249`](../../electron/main.ts#L226-L249)） | 窗口切到启动页后恢复 |
| 会话 wrapper 10 分钟空闲销毁（[`rpc-manager.ts:244-248`](../../lib/rpc-manager.ts#L244-L248)） | SSE 打开期间心跳 `keepAlive()` 顺延计时（[`events/route.ts:103-114`](../../app/api/agent/[id]/events/route.ts#L103-L114)）；销毁只停事件流 | 不再更新，界面仍在 |
| fork 预注册失败等 RPC 异常 | 命令路径 try/catch + `agent_error` 事件 → 自定义错误消息入列表（[`agent-event-apply.ts:88-105`](../../hooks/agent-session/agent-event-apply.ts#L88-L105)） | 聊天流内错误消息 |

## 4. 最可能根因结论

**综合排序**（证据等级见前表）：

1. **渲染期未捕获异常 × 全仓无错误边界（中强）**——"对话中"对应 SSE 事件驱动的高频 re-render，任何一条渲染异常都必然整树卸载成白屏；具体触发载荷未知，但 §3.1 列出的 `content` 形状缺口是现成的候选点。
2. **渲染进程 OOM/GPU 崩溃 × 无 render-process-gone 处理（中强，仅桌面模式）**——长会话渲染负载与全量重读是事实性放大因素；崩溃后永久白屏与"突然"吻合。
3. **上游 pi-ai 0.84.3 O(n²) 事件循环冻结（作为白屏解释为弱；作为"对话中稳定性"缺陷为实锤）**——本地依赖实锤含缺陷代码，但症状应是卡住而非白屏。
4. SSE 断连 / 服务崩溃 / wrapper 销毁等路径——有兜底 UI，基本排除。

两个结构性缺口（无错误边界、无渲染进程崩溃处理）的存在本身是**强证据、无需复现即可确认**；未知的只是报告者踩中的是哪一个（或叠加）。

## 5. 建议的诊断手段与最小修复方向

### 5.1 向报告者收集（ issue 目前零信息）

1. 桌面版还是 Web？应用版本号（设置页/关于）。
2. 模型与 Provider（是否 OpenRouter 等推理模型中转）。
3. 白屏时：窗口是否可交互？任务管理器中渲染进程（Pi Agent Desktop 子进程）是否存活？Alt+Ctrl+R / 重启应用后对话是否还在？
4. 白屏前是否出现过红色"连接已彻底中断"横幅或"正在重新启动本地服务"启动页？
5. 桌面版日志：`%APPDATA%/Pi Agent Desktop/logs/main.log`（代码写入点 [`main.ts` `getLogFilePath()`](../../electron/main.ts)）。

### 5.2 代码侧诊断手段（按性价比排序）

1. **加 `app/global-error.tsx` + 顶层 ErrorBoundary**：既是最小修复也是诊断探针——把渲染异常通过 `console.error`（配合下一条）或 IPC 上报主进程日志，白屏会变成"白屏 + 日志里的堆栈"。
2. **`mainWindow.webContents.on("render-process-gone", ...)`**：记录 `details.reason`（`oom`/`crashed`/…）与 `exitCode` 到 main.log，并可 `webContents.reload()` 自动恢复；同时补 `did-fail-load`（运行期）与 `"unresponsive"` 记录。
3. **渲染进程 console 采集**：`webContents.on("console-message")` 或 `session.defaultSession` 日志桥接到 main.log（现有 [`log-format.ts`](../../electron/log-format.ts) 基建可复用），复现时无需打开 DevTools。
4. 复现观察渲染子进程内存曲线（任务管理器/Process Explorer），若持续单调上涨至崩溃则坐实 §3.2。

### 5.3 最小修复方向（不动业务逻辑）

1. 顶层 ErrorBoundary（包裹 `ChatWindow` 或整个 `AppShell`）+ `global-error.tsx`——把"整树卸载"变成"错误卡片 + 重试"，同时消除最大一类白屏。
2. `render-process-gone` 日志 + `reload()` 恢复——消除第二大类白屏（桌面）。
3. [`MessageView.tsx:140-145`](../../components/MessageView.tsx#L140-L145)、[`196-201`](../../components/MessageView.tsx#L196-L201)、[`206-208`](../../components/MessageView.tsx#L206-L208) 的 `content` 处理补 `Array.isArray` 防御（与 `AssistantMessageView` 的 `?? []` 对齐）。
4. 关注/升级 pi-ai：#8648 修复版发布后升级（或临时 patch-package 将其 reasoning_details 累积改为 parse-once）。

## 本次调研执行的验证

```text
gh issue view 20 --json author,body,comments,createdAt,state,title   # 原文核实（正文空、0 评论）
gh issue view 9/14/16/18/19/21 …                                      # §0 概览逐一核实
grep -rn "componentDidCatch|ErrorBoundary|getDerivedStateFromError" app components hooks lib   # 0 命中
grep -rn "render-process-gone|did-fail-load|unresponsive|crashReporter" electron/               # 0 命中
node -e "require('…/pi-coding-agent/package.json').version"           # 0.84.3
node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:441-453  # 与上游 #8648 逐行比对
npm view @earendil-works/pi-ai versions                               # 0.84.3 为最新，无修复版
gh api search/issues repo:earendil-works/pi white screen / blank / freeze  # 上游检索（#8648 等）
git log --format="%h %ad %s" faa0099 34c0385 …                        # 版本时间线
```

## 最终判断

- **对"白屏 = 两个结构性缺口之一"：高置信（强证据）。** 无错误边界 + 无渲染进程崩溃处理，二者在当前源码中均为事实性缺失，任一被触发都精确产生"对话中突然白屏"。
- **对具体触发机制：证据不足，保持排序假设。** issue 零信息，报告者模式/版本/模型/白屏后进程状态全部未知；§5.1 的判据问题（进程是否存活）足以一次性裁决两大候选。
- **对上游 pi-ai 0.84.3 O(n²) 缺陷：高置信存在（本地代码逐行吻合），但不是白屏的首选解释。** 它解释"卡住"，不解释"白屏"；建议独立跟踪，勿在关闭 #20 时混为一谈。
- **对 issue #20 的处置建议：保持 Open。** 优先落地 §5.3 的 ErrorBoundary 与 `render-process-gone` 处理（两者无论报告者踩中哪个都受益），同时用 §5.1 的问题清单向报告者索取一次信息；拿到日志后按 §3 的判据表即可闭环。
