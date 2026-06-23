# Pi Agent Desktop 架构审查报告

> **审查日期**：2026-06-22
> **审查方法**：5 个并行 subagent 分领域深度审查（GLM-5.2 CodingPlan），覆盖 `app/api`、`lib`、`components/hooks`、`electron`、整体工程化五大领域
> **审查基线**：`main` 分支，package.json `0.7.13`
> **配套文档**：[ARCHITECTURE.md](ARCHITECTURE.md)（项目权威架构参考）

---

## 目录

- [执行摘要](#执行摘要)
- [问题严重度总览](#问题严重度总览)
- [TOP 10 高优先级改进项](#top-10-高优先级改进项)
- [横切主题分析](#横切主题分析)
- [第一章 · app/api 路由层](#第一章--appapi-路由层)
- [第二章 · lib 服务端库](#第二章--lib-服务端库)
- [第三章 · 前端 components / hooks](#第三章--前端-components--hooks)
- [第四章 · Electron 桌面端](#第四章--electron-桌面端)
- [第五章 · 整体架构 / 构建 / 工程化](#第五章--整体架构--构建--工程化)
- [综合改进路线图](#综合改进路线图)
- [附录：审查方法与覆盖范围](#附录审查方法与覆盖范围)

---

## 执行摘要

Pi Agent Desktop 是 [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) 的极简个人桌面客户端，复用同一套 Next.js 14 App Router + React 代码同时支持浏览器（:30141）与 Electron 两种模式。生产模式通过 `ELECTRON_RUN_AS_NODE=1` 让 Electron 自身降级为 Node.js 启动 Next.js standalone `server.js` 子进程，主进程开 `BrowserWindow` 指向本地端口，进程内直接持有 `AgentSession` 并通过 SSE 单向推送事件到浏览器。

**总体评价**：架构思路成熟、文档质量在个人项目中属顶级水准（[docs/ARCHITECTURE.md](ARCHITECTURE.md) 786 行权威参考 + CI 双平台覆盖 + 关键路径测试护栏齐全），模块化与关注点分离做得相当好。但工程细节层面存在一系列**安全假象、资源泄漏、文档漂移与激进版本组合**问题，部分缺陷会随项目规模与用户增长线性放大。

**关键发现统计**：

| 严重度 | 数量 | 含义 |
|---|---|---|
| 🔴 严重 | **21** | 影响安全 / 数据正确性 / 稳定性 / 阻碍演进 |
| 🟡 中等 | **37** | 影响可维护性 / 性能 / 一致性 |
| 🟢 轻微 | **49** | 风格 / 最佳实践 |

**一句话总结**：项目设计成熟，但**安全防护链存在系统性漏洞**（鉴权缺失 + CSP 失效 + 远程任意命令执行面），**资源生命周期管理有多处泄漏**（SSE listener、blob URL、孤儿文件、preload 监听器），**文档与代码已出现明显漂移**（版本号、globalThis 计数、README 结构）。

---

## 问题严重度总览

| 模块 | 🔴 严重 | 🟡 中等 | 🟢 轻微 | 小计 |
|---|---:|---:|---:|---:|
| [app/api 路由层](#第一章--appapi-路由层) | 6 | 9 | 11 | 26 |
| [lib 服务端库](#第二章--lib-服务端库) | 4 | 8 | 9 | 21 |
| [前端 components / hooks](#第三章--前端-components--hooks) | 4 | 8 | 11 | 23 |
| [Electron 桌面端](#第四章--electron-桌面端) | 3 | 6 | 10 | 19 |
| [整体架构 / 构建 / 工程化](#第五章--整体架构--构建--工程化) | 4 | 6 | 8 | 18 |
| **合计** | **21** | **37** | **49** | **107** |

---

## TOP 10 高优先级改进项

> 按 ROI（影响 ÷ 改动成本）排序，建议优先处理。

| # | 问题 | 位置 | 类别 | 预期收益 |
|---|---|---|---|---|
| 1 | **`proxy.ts` 是死代码，CSP 从未生效** | [proxy.ts](../proxy.ts) + [next.config.ts](../next.config.ts) | 安全假象 | 消除"以为有防护其实没有"的认知偏差，30 分钟内可决 |
| 2 | **全栈无鉴权 / CSRF 防护，Web 模式可被任意网页远程接管** | 所有 API 路由 | 安全 | 堵住远程攻击面的根因，零业务改动 |
| 3 | **`POST /api/agent/new` 接受任意 `cwd`，并永久加入文件访问白名单** | [app/api/agent/new/route.ts:13-32](../app/api/agent/new/route.ts#L13-L32) | 安全 | 消除"一次请求永久提权文件访问"的攻击链 |
| 4 | **`POST /api/skills/install` 远程触发 `npx` 任意包安装（RCE 面）** | [app/api/skills/install/route.ts:14-34](../app/api/skills/install/route.ts#L14-L34) | 安全 | 关闭供应链 + 远程命令执行面 |
| 5 | **Electron 主窗口未注入 CSP** | [electron/main.ts:228-247](../electron/main.ts#L228-L247) | 安全 | 堵住 XSS→preload→`quitAndInstall` 攻击链 |
| 6 | **SSE `/api/agent/[id]/events` listener + interval 泄漏** | [app/api/agent/[id]/events/route.ts:46-66](../app/api/agent/[id]/events/route.ts#L46-L66) | 资源泄漏 | 修复长跑 Electron 进程内存/句柄增长 |
| 7 | **`useFileTabs` 闭包陈旧 bug：关闭 tab 选中错误标签** | [hooks/useFileTabs.ts:24-36](../hooks/useFileTabs.ts#L24-L36) | 正确性 | 5 行改动消除确定性 bug |
| 8 | **`ChatInput` 卸载时不释放 `URL.createObjectURL` 创建的 blob URL** | [components/ChatInput.tsx:118-129](../components/ChatInput.tsx#L118-L129) | 内存泄漏 | 10 行改动消除长期运行内存泄漏 |
| 9 | **`prompt`/`steer`/`followUp` 错误被吞掉，客户端永远等不到失败信号** | [lib/rpc-manager.ts:47-49](../lib/rpc-manager.ts#L47-L49) | 可观测性 | 解除生产诊断噩梦 |
| 10 | **文档说"三个 globalThis"，实际有五个** | [AGENTS.md](../AGENTS.md) / [ARCHITECTURE.md §14.1](ARCHITECTURE.md) | 文档漂移 | 消除维护者排查盲点 |

---

## 横切主题分析

下面把跨模块重复出现的问题归纳为四大主题，便于整体规划改进。

### 主题 1 · 安全防护链系统性失守 ⚠️

这是本次审查最严重的发现。**单一问题可被链式利用形成完整攻击链**：

```mermaid
flowchart LR
    A[攻击者控制的网页<br/>fetch 127.0.0.1:30141] --> B[无 CSRF/Origin 校验]
    B --> C[POST /api/agent/new<br/>cwd: '/']
    C --> D[整个磁盘被加入<br/>__piAllowedRootsCache]
    D --> E[/api/files PUT<br/>改写 package.json postinstall]
    E --> F[下次 npm install RCE]

    A --> G[POST /api/skills/install<br/>pkg: 任意]
    G --> H[npx 触发 preinstall 脚本]
    H --> I[直接 RCE]

    A --> J[Electron 渲染进程 XSS]
    J --> K[无 CSP 拦截]
    K --> L[调用 preload 暴露的<br/>quitAndInstall]
```

**关键缺陷分布**：

- 服务端无鉴权 / CSRF / Origin 校验（[app/api/](../app/api/) 全部路由）
- [proxy.ts](../proxy.ts) 死代码，CSP 从未注入
- `cwd` 白名单一次永久提权（[agent/new](../app/api/agent/new/route.ts)）
- `npx` 任意包安装（[skills/install](../app/api/skills/install/route.ts)）
- Electron 主窗口无 CSP（[main.ts:228-247](../electron/main.ts#L228-L247)）
- `sandbox: true` 未启用（[main.ts:240-242](../electron/main.ts#L240-L242)）
- preload `ipcRenderer.on` 不可清理（[preload.ts:6-9](../electron/preload.ts#L6-L9)）

**整改建议**：作为整体工作项立项，而非逐点修补。先做 (1) `middleware.ts` Origin/Host 校验 + CSRF token；(2) `proxy.ts → middleware.ts` 重命名让 CSP 生效；(3) `cwd` 白名单收敛；(4) `skills/install` 字符集白名单；(5) Electron 主窗口 CSP。这五步联动后，攻击面从"开放"降级到"可控"。

### 主题 2 · 资源生命周期管理 🔄

项目多处对"长连接 / 监听器 / 异步资源"的清理不完整，长跑场景下会缓慢泄漏：

| 资源 | 位置 | 问题 |
|---|---|---|
| SSE listener + heartbeat interval | [events/route.ts:46-66](../app/api/agent/[id]/events/route.ts#L46-L66) | `ReadableStream` 未定义 `cancel()`，客户端静默消失时不清理 |
| Fork 失败的孤儿 `.jsonl` | [rpc-manager.ts:131-163](../lib/rpc-manager.ts#L131-L163) | 注释承诺"下次覆盖"，实际文件名带 uuid 永不覆盖 |
| ChatInput blob URL | [ChatInput.tsx:118-129](../components/ChatInput.tsx#L118-L129) | 卸载时不 revoke |
| preload `ipcRenderer.on` | [preload.ts:6-9](../electron/preload.ts#L6-L9) | 不返回 unsubscribe，N 次注册累积 N 个 listener |
| `?includeState=1` GET 重置 idle timer | [sessions/[id]/route.ts:114-119](../app/api/sessions/[id]/route.ts#L114-L119) | 观测请求让会话永不回收 |
| `AgentSessionWrapper.destroy()` 不 await unsubscribe | [rpc-manager.ts:247-258](../lib/rpc-manager.ts#L247-L258) | 未来若 unsubscribe 变 async 会资源未释放 |

**共性根因**：异步资源的"取消/清理"路径没有作为一等公民设计。建议引入团队规范：所有 `ReadableStream` 必须实现 `cancel`，所有 `addEventListener` 必须返回 dispose，所有 `setInterval` 必须有 clearInterval 兜底。

### 主题 3 · globalThis 状态治理 🌐

项目用 `globalThis.__pi*` 抗 Next.js HMR，模式一致且都有 `declare global { var ... }` 类型化，这点做得很好。但**文档与实际严重漂移**：

| 变量 | 模块 | 用途 | 文档记录 |
|---|---|---|---|
| `__piSessions` | [rpc-manager.ts:278](../lib/rpc-manager.ts#L278) | 活跃会话注册表 | ✅ |
| `__piStartLocks` | [rpc-manager.ts:278](../lib/rpc-manager.ts#L278) | 并发启动共享 Promise 锁 | ✅ |
| `__piSessionPathCache` | [session-reader.ts:46](../lib/session-reader.ts#L46) | sessionId → .jsonl 路径缓存 | ✅ |
| `__piWriteLocks` | [session-lock.ts:22](../lib/session-lock.ts#L22) | per-key 文件写锁 | ❌ 文档遗漏 |
| `__piAllowedRootsCache` | [files/[...path]/route.ts:109](../app/api/files/[...path]/route.ts#L109) | 文件访问白名单缓存 | ❌ 文档遗漏 |
| `__piLoginCallbacks` | [auth/login/[provider]/route.ts](../app/api/auth/login/[provider]/route.ts) | OAuth 回调 promise | ❌ 文档遗漏 + 缺 `declare global` |

**整改建议**：在 [ARCHITECTURE.md §14.1](ARCHITECTURE.md) 增加完整表格（变量名 / 模块 / 用途 / TTL / 回收策略），并把三个文档（AGENTS.md / CLAUDE.md / ARCHITECTURE.md）的"三个"统一改为"五个"（或"六个"含 login callbacks）。

### 主题 4 · 文档与代码漂移 📝

[docs/ARCHITECTURE.md](ARCHITECTURE.md) 质量很高，但已出现明显滞后：

| 文档声明 | 实际情况 | 结论 |
|---|---|---|
| 顶部版本 `v0.7.11` | package.json `0.7.13` | ❌ 滞后 2 patch |
| pi-coding-agent `^0.78.0` | 实际 `^0.79.8` | ❌ SDK 滞后 |
| "17 个顶层组件" | 实际 16 个 `.tsx` + 1 算法文件 | ⚠️ 口径不清 |
| "agent-session/ 子 hooks 8 个" | 8 个 `.ts` 但其中 5 个是纯函数非 hook | ⚠️ 措辞误导 |
| README 项目结构段 | 缺 `hooks/` `bin/` `proxy.ts` 等 | ⚠️ 严重不全 |

**整改建议**：增加 `docs:check` CI 脚本，grep 比对文档中的版本号 / 计数与实际代码。

---

## 第一章 · app/api 路由层

### 模块概览

`app/api` 下共 13 个路由目录、24 个 `route.ts`，覆盖 agent 控制、SSE 推送、会话历史读写、文件浏览、模型/技能配置、OAuth 登录等场景。整体建立了统一的错误处理三件套（`getRequestId` / `logApiError` / `x-request-id` 响应头）、通过 `globalThis` 解决了 Next.js HMR 状态丢失问题、对文件路径做了 Windows/POSIX 双向规范化与白名单校验。架构思路清晰，但**全栈缺失鉴权层**、SSE 资源清理不完整、输入校验依赖类型断言，是核心风险。

### 优点

- 错误处理范式统一：所有抛错路径都走 `logApiError`，并在响应头回传 `x-request-id`，便于日志追溯（[lib/api-error.ts](../lib/api-error.ts)）。
- 热重载安全：会话注册表、启动锁、路径缓存、写锁、登录回调全部挂 `globalThis`，避免 HMR 丢状态。
- Fork 顺序合约清晰：预注册新 wrapper 再销毁旧 wrapper，避免"返回时新 id 不在注册表"的竞态（[rpc-manager.ts:140-159](../lib/rpc-manager.ts#L140-L159)）。
- 文件路由路径校验：`isPathAllowed` 同时处理 Windows 大小写、UNC 路径、分隔符差异（[files/[...path]/route.ts:135-154](../app/api/files/[...path]/route.ts#L135-L154)），并支持 HTTP Range 请求与流式取消。
- DELETE 级联重写父指针：删除会话时把子会话的 `parentSession` 重写到祖父，配合 `withFileLock` 原子写入（[sessions/[id]/route.ts:124-145](../app/api/sessions/[id]/route.ts#L124-L145)）。

### 问题与优化点

#### 🔴 严重（影响安全 / 数据正确性 / 稳定性）

- **全栈无鉴权 / CSRF 防护，Web 模式下可被任意网页远程接管**
  - 位置：所有路由；最敏感的入口 [files/[...path]/route.ts](../app/api/files/[...path]/route.ts)、[agent/new/route.ts](../app/api/agent/new/route.ts)、[skills/install/route.ts](../app/api/skills/install/route.ts)、[select-directory/route.ts](../app/api/select-directory/route.ts)
  - 现象：无 `middleware.ts`、无 Origin/Host 校验、无 CSRF token、无 session cookie。任何能访问 :30141 的请求都被默认信任。
  - 风险：
    1. Web 模式若 bind `0.0.0.0`，局域网内任何主机可读写文件、安装 npm 包、调用 PowerShell 选目录弹窗骚扰用户。
    2. 即便 bind `127.0.0.1`，用户访问的任意网页都可通过 `fetch("http://127.0.0.1:30141/...")` 发起 DNS rebinding / simple-request 攻击（GET 与 `text/plain` POST 默认不触发 CORS preflight）。
    3. Electron 模式同样暴露在 127.0.0.1，本地其它进程或被入侵的浏览器页面可调用。
  - 建议：
    1. 增加 `middleware.ts`，校验 `Origin`/`Host` 头只允许 `127.0.0.1`、`localhost`、`allowedDevOrigins`；拒绝其他来源的非 GET 请求。
    2. 给浏览器侧注入一次性 CSRF token，所有写操作（POST/PUT/PATCH/DELETE）强制校验。
    3. Web 服务器默认 bind `127.0.0.1`，需要 LAN 访问时显式开启并加鉴权。

- **`POST /api/agent/new` 接受任意 `cwd`，并把其永久加入文件访问白名单**
  - 位置：[agent/new/route.ts:13-32](../app/api/agent/new/route.ts#L13-L32)
  - 现象：仅校验 `existsSync(cwd)`，未校验是否属于用户项目集合；第 31 行直接 `globalThis.__piAllowedRootsCache?.roots.add(cwd)`。
  - 风险：一次 `cwd: "/"` 或 `cwd: "C:\\"` 请求即可让后续 `/api/files` 读写整个磁盘（包括 `~/.ssh`、`.env`、浏览器 profile）。配合上面的无鉴权问题，等于远程任意文件读写。
  - 建议：白名单只接受 `~`、`~/pi-cwd-*`、用户在 UI 中显式选择过的目录；显式拒绝根目录、家目录本身、系统目录。缓存键改为"用户已确认"集合，与"已访问 cwd"分离。

- **`POST /api/skills/install` 远程触发 `npx` 任意包安装**
  - 位置：[skills/install/route.ts:14-34](../app/api/skills/install/route.ts#L14-L34)
  - 现象：把请求体 `pkg.trim()` 直接作为 `npx skills add <pkg>` 参数，60 秒超时，无白名单。
  - 风险：即便 `runNpx` 用 `execFile`（非 shell），攻击者仍可指定任意包名触发下载执行（npm 包 install 时 preinstall 脚本即可 RCE）。这是典型的供应链 + 远程命令执行面。
  - 建议：在鉴权落地前，至少 (a) 限制 `pkg` 字符集为 `/^[\w.\-]+\/[\w.\-@:]+$/`（已在 [search 解析](../app/api/skills/search/route.ts#L52) 中存在该正则，复用即可）；(b) 限制可调用来源（同源 + token）；(c) 安装命令落地到独立低权限子进程而非主 Next.js 进程。

- **`/api/files` PUT 可写入任意白名单内文件，无路径粒度限制**
  - 位置：[files/[...path]/route.ts:399-440](../app/api/files/[...path]/route.ts#L399-L440)
  - 现象：只校验 path 在 allowed-roots 内、单文件 ≤512KB；任何已打开项目下的任意文件（包括 `.git/config`、`package.json`、`node_modules/...`）都可被覆盖。
  - 风险：配合上面的 cwd 提权，等同于持久化后门（改 `package.json` 的 postinstall）。
  - 建议：(a) 拒绝写入 `.git/`、`node_modules/`、`.env*` 等敏感路径；(b) 必须配合鉴权。

- **`/api/auth/login/[provider]` 缺少 `declare global` 声明 + SSE 异常路径未关流**
  - 位置：[auth/login/[provider]/route.ts:8-14](../app/api/auth/login/[provider]/route.ts#L8-L14)
  - 现象：直接 `globalThis.__piLoginCallbacks`，但本文件未写 `declare global { var __piLoginCallbacks: ... | undefined }`，TS 严格模式下会报错；运行时仅靠其他文件未定义此 global 才"恰好"工作。
  - 风险：类型不安全；`getCallbackRegistry()` 只在本文件出现，未在入口集中初始化，HMR 后 Map 会丢失正在等待的 promise（resolve/reject 永不触发 → 前端 SSE 挂起）。
  - 建议：补 `declare global`；把所有 `globalThis.__pi*` 集中到一个 bootstrap 模块统一初始化。

- **`POST /api/agent/[id]` 对 body 不做白名单校验，直接派发到 `session.send`**
  - 位置：[agent/[id]/route.ts:13-19](../app/api/agent/[id]/route.ts#L13-L19)
  - 现象：`const body = await req.json() as { type: string; ... }`，`type` 字段未校验，直接 `existing.send(body)`；`send` 内 switch 把 `command.message`、`command.images`、`command.toolNames` 等原样传给 pi。
  - 风险：layered defense 缺失——即便鉴权到位，构造异常 type 也只能靠 pi 内部 throw。错误信息会通过 `errorMessage(error)` 回显，可能泄漏内部路径/堆栈。
  - 建议：定义 `type` 白名单 + 各 type 的 zod schema；超出白名单返回 400。

#### 🟡 中等

- **SSE `/api/agent/[id]/events` 存在 listener + interval 泄漏**
  - 位置：[events/route.ts:46-66](../app/api/agent/[id]/events/route.ts#L46-L66)
  - 现象：`cleanup` 仅挂在 `req.signal.abort` 上；`ReadableStream` 未定义 `cancel()`。如果客户端"静默消失"未触发 abort（代理超时、网络中断），那么 `setInterval(heartbeat)` 仍尝试 enqueue 被 try/catch 吞掉；`unsubscribe()` 永远不调用；`controller.close()` 也未执行。
  - 风险：长跑 Electron 进程的内存与句柄缓慢增长；同一个会话多次重连后 listener 数爆炸，每次 agent 事件被广播 N 次。
  - 建议：在 `ReadableStream` 上增加 `cancel() { cleanup(); }`；并轮询 `controller.desiredSize === null` 主动判定关闭。

- **`?includeState=1` 的 GET 会重置会话 idle timer，使会话永不回收**
  - 位置：[sessions/[id]/route.ts:114-119](../app/api/sessions/[id]/route.ts#L114-L119) 调用 [rpc-manager.ts:163](../lib/rpc-manager.ts#L163) `send({type:"get_state"})`
  - 现象：`send` 开头 `this.resetIdleTimer()`。任何轮询该路由的客户端（侧边栏刷新、统计面板）会让 wrapper 永不进 10 分钟 idle 回收。
  - 建议：新增一个只读 `peekState()` 方法，不触发 `resetIdleTimer`；或区分"控制"与"观测"两类操作。

- **`resolveSessionPath` 缓存未命中即扫描全部 sessions，可被 DoS 放大**
  - 位置：[session-reader.ts:51-58](../lib/session-reader.ts#L51-L58)
  - 现象：任意未知 sessionId 触发 `listAllSessions()`（遍历 `~/.pi/agent/sessions/**/*.jsonl` 并读首行）。
  - 风险：攻击者循环请求随机 UUID，每次都触发全盘扫描。无速率限制、无负缓存。
  - 建议：(a) 命中失败后短时间内对该 id 做负缓存；(b) `listAllSessions` 自身做目录遍历限流。

- **`DELETE /api/sessions/[id]` 级联重写全部兄弟文件，O(N) 读 IO + 部分失败无回滚**
  - 位置：[sessions/[id]/route.ts:124-145](../app/api/sessions/[id]/route.ts#L124-L145)
  - 现象：遍历同目录所有 `.jsonl`，逐个 `readFile` + `rewriteChildHeader` + `withFileLock(write)`。某个兄弟写入失败不会中断整体流程，但也不会重试。
  - 风险：会话目录文件多时（数千），单次 DELETE 阻塞较久；写入失败时子会话 parentSession 残留指向已删除 id，形成孤儿引用。
  - 建议：(a) 只 `readFirstLineAsync` 取头部过滤后再写入；(b) 失败的写入记录到日志或返回 `partial: true`。

- **`/api/models-config` 使用同步 `readFileSync` / `writeFileSync`**
  - 位置：[models-config/route.ts:20-28](../app/api/models-config/route.ts#L20-L28)
  - 现象：请求路径上走同步 IO，会阻塞 Next.js 单线程事件循环；`PUT` 直接把 `Record<string, unknown>` 序列化覆盖到 `models.json`，无 schema 校验。
  - 建议：换 `fs/promises`；对 body 做最小结构校验。

- **`/api/files` list 对每个 entry 触发独立 `stat`，大目录下产生 N 次 syscall**
  - 位置：[files/[...path]/route.ts:235-260](../app/api/files/[...path]/route.ts#L235-L260)
  - 建议：用 `readdir(withFileTypes: true)` 一次性拿到 `dirent.isDirectory()`，按需补 stat；或限制并发（p-limit 风格）。

- **`/api/statusline` 未校验 `cwd`，可触发任意目录的 git 命令**
  - 位置：[statusline/route.ts:140-165](../app/api/statusline/route.ts#L140-L165)
  - 现象：`cwd` 来自 query string，直接传给 `execFileAsync("git", [...], { cwd })`。无 allowed-roots 校验。
  - 风险：攻击者可探测任意路径是否为 git 仓库、读取 `.git/HEAD`、通过 git hook 路径间接 RCE。
  - 建议：复用 `/api/files` 的 `getAllowedRoots` 做同样的白名单校验。

- **`/api/skills/install` 与 `/api/skills/search` 的错误返回把 npm 原始输出透传给客户端**
  - 位置：[skills/install/route.ts:36-43](../app/api/skills/install/route.ts#L36-L43)、[skills/search/route.ts:108-117](../app/api/skills/search/route.ts#L108-L117)
  - 风险：npm 错误日志可能包含内部路径、registry URL、tarball hash、甚至代理凭据；属于信息泄漏。
  - 建议：服务端完整记录日志，客户端只返回标准化的简短错误码 + requestId。

- **错误状态码一律 500，未区分 4xx**
  - 位置：[agent/[id]/route.ts:42](../app/api/agent/[id]/route.ts#L42)、[sessions/[id]/context/route.ts:30](../app/api/sessions/[id]/context/route.ts#L30) 等
  - 建议：包装一个 `ApiError` 类（status + code），让上层显式抛 400/404/409 等。

- **`/api/auth/api-key/[provider]` POST 未校验 provider 字符集**
  - 位置：[auth/api-key/[provider]/route.ts:23-33](../app/api/auth/api-key/[provider]/route.ts#L23-L33)
  - 风险：如果 pi-coding-agent 内部以 provider 名作文件名，`../` 等字符可能造成配置文件路径穿越。
  - 建议：在路由层先做 `/^[a-z0-9-]+$/` 校验。

#### 🟢 轻微

- **响应包格式不统一**：`/api/agent/*` 用 `{success, data}`；`/api/sessions` 用 `{sessions}`；`/api/auth/*` 用 `{ok}` 或 `{providers}`；`/api/health` 用 `{ok:true}`。建议统一成 `{data}` + `{error}` 两套 envelope。
- **`/api/health` 仅返回 `{ok:true}`**（[health/route.ts](../app/api/health/route.ts)），未检查 `globalThis.__piSessions`、磁盘、pi-coding-agent 可加载性等。
- **`/api/sessions/new/route.ts` 是死代码**（10 行，仅返回 410），建议删除并由前端清理对应调用。
- **`/api/files` 的 `IGNORED_NAMES` 中 `.git` 出现两次**（[files/[...path]/route.ts:17 与 25](../app/api/files/[...path]/route.ts#L17)）。
- **`/api/models` 静默吞错**（[models/route.ts:35](../app/api/models/route.ts#L35) `catch { /* return empty */ }`），调试困难。
- **`/api/auth/providers` 与 `/api/auth/all-providers` 功能高度重叠**，建议合并为 `/api/auth/providers?types=oauth,api_key`。
- **`/api/agent/[id]/events` 缺少 `runtime = "nodejs"` 显式声明**，全部路由都未指定 runtime。Electron 打包场景下建议显式锁定。
- **`/api/default-cwd` 用 POST 创建目录**，按 REST 语义应是幂等 POST 或 GET。
- **`logApiError` 的 `params` 字段未脱敏**（[api-error.ts:38-46](../lib/api-error.ts#L38-L46)），若未来扩展到记录 body，API key / token 容易泄漏到日志。
- **类型断言滥用**：`as { type: string; [key: string]: unknown }` 等模式遍布 9 处，没有任何运行时校验。考虑引入 zod 或 valibot。
- **`/api/skills/search` 在线 fetch `skills.sh` 时未设 `AbortSignal`/超时**（[skills/search/route.ts:60-63](../app/api/skills/search/route.ts#L60-L63)）。

### 优先级建议（按 ROI 排序）

1. 落地 `middleware.ts`：Origin/Host 校验 + CSRF token（堵住全部远程攻击面的根因）
2. `/api/agent/new` 与 `/api/files` 的 cwd 白名单收敛
3. SSE `events` 路由补 `cancel()` + 主动关闭检测
4. `?includeState` 路径与 `send` 解耦
5. 统一错误响应模型：`ApiError` + 4xx/5xx 区分 + zod 边界校验

---

## 第二章 · lib 服务端库

### 模块概览

`lib/` 由 14 个服务端库文件 + 1 个共享 UI 文件（`panel-layout.js`、`ayu-syntax-theme.ts`）+ 1 个客户端辅助文件（`agent-client.ts`）组成。整体设计清晰：状态集中在 `rpc-manager.ts` 的 `AgentSessionWrapper`，纯函数（`normalize`、`session-cascade`、`slash-commands`）与副作用（`rpc-manager`、`session-reader`、`session-lock`）边界分明，几乎每个非平凡模块都有对应的 `*.test.ts`。关键陷阱（HMR / globalThis、fork 预注册、idle 超时）在注释中都有显式说明。

### 优点

- **纯函数与副作用分离彻底**：`rewriteChildHeader`、`normalizeToolCalls`、`buildSlashCommandItems`、`resolveCustomPathSelection` 完全无 IO，测试覆盖完善。
- **globalThis 抗 HMR 模式一致**：四个注册表都挂 `globalThis`，模式统一且都有显式 `declare global` 声明。
- **Fork 预注册契约清晰**：注释明确"先预注册新 wrapper 再销毁旧 wrapper"，失败时不 destroy 旧 wrapper 的语义合理（[rpc-manager.ts:157-163](../lib/rpc-manager.ts#L157-L163)）。
- **`npx.ts` 规避 Windows `npx.cmd` + shell 注入**：通过查找 `npx-cli.js` 直接用 `node` 启动，绕开 CVE-2024-27980 又避免了 `shell: true` 的注入面（[npx.ts:14-34](../lib/npx.ts#L14-L34)）。
- **`withFileLock` 设计干净**：per-key 链式 promise、自动清理 map、`finally` 保证释放，测试覆盖了并发串行化、跨路径不互斥、异常释放、清理。
- **`readFirstLineAsync` 流式读取**：避免加载整个文件只为第一行（[session-reader.ts:67-90](../lib/session-reader.ts#L67-L90)）。

### 问题与优化点

#### 🔴 严重（影响安全 / 数据正确性 / 稳定性）

- **`prompt`/`steer`/`followUp` 错误被吞掉，客户端永远等不到失败信号**
  - 位置：[rpc-manager.ts:47-49](../lib/rpc-manager.ts#L47-L49)
  - 现象：
    ```ts
    case "prompt": {
      this.inner.prompt(...).catch((err) => { console.error("pi prompt failed:", err); });
      return null;
    }
    ```
    `send()` 立即返回 `null`，HTTP 200 给前端。如果 pi 内部 prompt 失败（鉴权过期、配额、网络），错误只进 `console.error`，SSE 不会推 error 事件。
  - 风险：用户无法区分"模型在思考"和"请求已死"，只能靠 10 分钟 idle 超时被动清理。生产环境非常难诊断。
  - 建议：在 wrapper 上维护一个 `lastError` 字段，prompt catch 时既打日志也通过 `this.listeners` 推送一个 `{ type: "agent_error", error }` 事件；或在 catch 后调用 `this.destroy()` 强制让下一次请求重建。

- **`set_thinking_level` 的 deepseek 硬编码 hack 越过封装，直接改 `agent.state`**
  - 位置：[rpc-manager.ts:109-115](../lib/rpc-manager.ts#L109-L115)
  - 现象：
    ```ts
    if (level === "xhigh" && (this.inner.model as { compat?: ... } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
      this.inner.agent.state.thinkingLevel = "xhigh";
    }
    ```
  - 风险：(1) 字符串字面量 `"deepseek"` 硬编码，pi 改名就静默失效；(2) 通过 `as` 强转 + 直接改 state，绕开了 `setThinkingLevel` 本应封装的不变量；一旦 pi 在 setter 里加副作用（如重新构建 system prompt），这里改了状态却没触发副作用，会产生不一致。
  - 建议：把这条逻辑上报到 pi 侧（给 pi 提 issue/PR 让 `setThinkingLevel` 自己处理 compat），或在 `AgentSessionLike` 接口上显式声明一个 `forceThinkingLevelCompat(level)` 方法，把 hack 限制在类型契约内。

- **Fork 失败时注释承诺"下次会覆盖"，但实际会无限累积孤儿 `.jsonl`**
  - 位置：[rpc-manager.ts:131-163](../lib/rpc-manager.ts#L131-L163)
  - 现象：注释写"orphaned new .jsonl file on disk is acceptable; the next fork will overwrite it"。但 `SessionManager.create` / `createBranchedSession` 每次都用新的 `<timestamp>_<uuid>.jsonl` 命名，**不会覆盖**。
  - 风险：长时间运行 + 网络抖动场景下，`~/.pi/agent/sessions/<cwd>/` 下会堆积大量零字节孤儿文件，`listAllSessions` 扫描越来越慢，sidebar 出现大量空会话。
  - 建议：catch 块里 `await unlink(newSessionFile).catch(()=>{})` 清理（原子且无副作用），或加定期 GC。

- **DELETE 级联与 fork 的跨文件竞态：children 重写不是原子的**
  - 位置：[sessions/[id]/route.ts:139-182](../app/api/sessions/[id]/route.ts#L139-L182)
  - 现象：步骤 3 循环 `withFileLock(childPath, ...)` 改写每个孩子，步骤 5 才 `withFileLock(filePath, ...)` 删除父。在步骤 3 进行中或步骤 3-5 之间，如果并发的 fork 操作正在读取 parent 或某个孩子，孩子被重写时 parent 可能已失效或被删，fork 会抛错或读到不一致状态。
  - 风险：级联删除是用户级破坏性操作，竞态导致的 fork 失败会让用户在 UI 上看到"会话突然消失"。
  - 建议：(1) 在 fork 的 `case` 中检查 `sessionManager.getHeader()?.parentSession` 是否仍存在；(2) 给 DELETE 加一个跨文件的协调点——在 `__piSessions` 里 lookup 父子链，先 destroy 所有相关 wrapper 再做 IO；(3) 缩短步骤 3-5 之间的窗口。

#### 🟡 中等

- **`getSessionEntriesAsync` 全文件 `readFile + split('\n')`，无大小上限、无流式解析**
  - 位置：[session-reader.ts:219-232](../lib/session-reader.ts#L219-L232)
  - 现象：对于几十 MB 的长会话，`readFile(filePath, "utf8")` 会把整个文件加载到内存，再 `split("\n")` 又复制一份字符串数组。每次 `GET /api/sessions/[id]`、`GET /api/sessions/[id]/context` 都会触发。
  - 建议：用 `readline.createInterface({ input: createReadStream(filePath) })` 流式逐行解析。

- **`resolveSessionPath` cache miss 时多次并发触发 `listAllSessions()`**
  - 位置：[session-reader.ts:52-60](../lib/session-reader.ts#L52-L60)
  - 建议：复用 `__piStartLocks` 的模式，加一个 `__piSessionScanInflight: Promise<void> | null`，第一个 miss 触发扫描，其他人 `await` 同一个 promise。

- **`startRpcSession` 锁泄漏：in-flight promise 在 map 中但失败时 caller 拿到的是同一个 rejected promise**
  - 位置：[rpc-manager.ts:319-323](../lib/rpc-manager.ts#L319-L323)
  - 建议：在 `startRpcSession` 内部 `.catch` 转成一个 Result 类型，或至少在 JSDoc 里明确"调用方必须 catch"。

- **`findNpxCli` 每次调用都做同步 `existsSync` 检查，结果不缓存**
  - 位置：[npx.ts:18-34](../lib/npx.ts#L18-L34)
  - 建议：模块级 `let cachedNpxCli: string | null | undefined;`，第一次解析后缓存。

- **`session-lock.ts` 不支持重入，且没有跨进程锁**
  - 位置：[session-lock.ts:5-14](../lib/session-lock.ts#L5-L14)
  - 风险：Electron 场景下主进程 + Next.js 子进程是两个不同的 Node 进程，**进程内的 promise 锁对另一个进程无效**——如果两边同时写同一个 `.jsonl`，仍会损坏文件。
  - 建议：(1) 短期——明确文档"会话文件写入只在 Next.js 子进程内进行"；(2) 长期——用 `proper-lockfile` 或 OS 级 flock 做跨进程锁。

- **`buildSessionContext` 与 pi 的 `piBuildSessionContext` 重复实现 compaction 索引计算**
  - 位置：[session-reader.ts:132-184](../lib/session-reader.ts#L132-L184)
  - 风险：一旦 pi 改了 compaction entry 的 schema，这里会静默错位。
  - 建议：检查 pi 是否暴露了 entryIds / path 数组；或用 schema validation 在边界做一次校验。

- **`AgentSessionWrapper.destroy()` 中 `unsubscribe?.()` 不 await**
  - 位置：[rpc-manager.ts:247-258](../lib/rpc-manager.ts#L247-L258)
  - 建议：把 `destroy` 改成 `async destroy(): Promise<void>`，内部 `await this.unsubscribe?.()`；fork 路径相应改 `await this.destroy()`。

- **`getSessionEntriesAsync` 解析失败行只 `console.error` 不计数**
  - 位置：[session-reader.ts:223-229](../lib/session-reader.ts#L223-L229)
  - 建议：返回 `{ entries, skippedLines: number }`，便于诊断磁盘损坏。

#### 🟢 轻微

- **`normalizeToolCallBlock` 缺少 `toolCallId` 时 fallback 到空字符串**会污染后续 toolResult 匹配（[normalize.ts:24-26](../lib/normalize.ts#L24-L26)）。建议加 `console.warn`。
- **`agent-client.ts` 中 `body.data as T` 强转，运行时无校验**（[agent-client.ts:24](../lib/agent-client.ts#L24)）。建议在关键命令上加轻量 schema 校验。
- **`panel-layout.js` 是 CommonJS 且无 TypeScript 类型**（[panel-layout.js](../lib/panel-layout.js) 全文）。建议改为 `panel-layout.ts` + `export`。
- **`slash-commands.ts` 中 `item.kind.includes(normalizedQuery)`** 让 "command" / "skill" 关键词可被搜索（[slash-commands.ts:54](../lib/slash-commands.ts#L54)），可能是 bug。
- **`custom-path-selection.ts` 的 `shouldClose` 永远是 `true`**，返回值结构冗余。
- **`api-error.ts` 的 `errorMessage` 对循环引用对象 fallback 到 `String(err)`**（`"[object Object]"`），可读性差。
- **`file-paths.ts` 全部为字符串拼接，无路径穿越校验**（[file-paths.ts](../lib/file-paths.ts) 全文）。建议在 `joinFilePath` 里加防御。
- **`session-lock.ts` 注释说不支持重入但没测试断言它会 deadlock**。
- **`custom-path-selection.ts` 的 `shouldClose` 永远是 `true`，返回值结构冗余**，过度抽象。

### 测试覆盖评估

| 模块 | 测试文件 | 覆盖评估 |
|---|---|---|
| rpc-manager | [rpc-manager.test.ts](../lib/rpc-manager.test.ts) | **不足**。覆盖了 idle timer、keepAlive、fork 取消路径。**缺**：fork 成功路径、`prompt` catch 的可观测性、`set_thinking_level` deepseek 分支、并发 `startRpcSession` 同 id 复用 in-flight promise、`destroy` 后再调用 `send` 抛错路径。 |
| session-cascade | [session-cascade.test.ts](../lib/session-cascade.test.ts) | **优秀**。边界覆盖全。 |
| session-lock | [session-lock.test.ts](../lib/session-lock.test.ts) | **优秀**。100 并发串行化、跨路径、异常释放、map 清理都覆盖。 |
| normalize | [normalize.test.ts](../lib/normalize.test.ts) | **优秀**。 |
| api-error | [api-error.test.ts](../lib/api-error.test.ts) | **优秀**。 |
| slash-commands | [slash-commands.test.ts](../lib/slash-commands.test.ts) | **良好**。 |
| custom-path-selection | [custom-path-selection.test.ts](../lib/custom-path-selection.test.ts) | **足够**。 |
| session-reader | **无 test 文件** | **缺失**。`buildTree`、`buildSessionContext`、`readFirstLineAsync`、`getSessionEntriesAsync`、`resolveSessionPath` 都没有单元测试。`buildSessionContext` 的 compaction 分支复杂度极高，**强烈建议补**。 |
| npx | **无 test 文件** | **缺失**。至少应 mock `execFile` 断言参数不含 shell 元字符。 |
| file-paths | **无 test 文件** | **缺失**。5 个纯函数应有测试，尤其 `joinFilePath` 的穿越防御。 |

**优先建议补的 3 个测试目标**：
1. `buildSessionContext` 在含 compaction entry + 多 branch 路径下，`entryIds` 与 `messages` 长度对齐。
2. `fork` 成功路径：mock `startRpcSession` 验证注册表在 `send("fork")` 返回前已含 `newSessionId`，旧 wrapper destroyed。
3. `getSessionEntriesAsync` 对损坏行 / BOM / CRLF 的行为。

### 优先级建议（按 ROI 排序）

1. 修 fork 孤儿文件累积（[rpc-manager.ts:131-163](../lib/rpc-manager.ts#L131-L163)）—— catch 块加一行 `unlink`。
2. 给 `prompt`/`steer`/`followUp` 加可观测错误通道（[rpc-manager.ts:46-49](../lib/rpc-manager.ts#L46-L49)）。
3. `getSessionEntriesAsync` 改流式读取。
4. 补 `session-reader.test.ts`（新文件）。
5. 删除 `set_thinking_level` 的 deepseek 硬编码 hack。

---

## 第三章 · 前端 components / hooks

### 模块概览

整体采用 `AppShell → ChatWindow → useAgentSession` 的单中心化架构：会话状态几乎全部集中在 `useAgentSession` 中（含 8 个 agent-session 子 hook），UI 层相对薄。SSE 流式通过自实现的 `AgentEventsManager` 管控（指数退避重连）。文件查看器内置自研 Myers diff 和虚拟化。设计思路成熟，但存在状态提升过度、跨组件通信走 window 自定义事件、单文件过长等典型问题。

### 优点

- **关注点分离清晰的 hook 拆分**：`use-agent-events` / `use-session-loader` / `use-chat-scroll` 等子 hook 各司其职，且配套 `.test.ts` 单测。
- **SSE 重连策略稳健**：`AgentEventsManager` 实现了指数退避（1s→30s）、最多 5 次尝试、`agentRunning` 守卫、`sid` 一致性检查，避免幽灵重连（[agent-events-manager.ts:79-103](../hooks/agent-session/agent-events-manager.ts#L79-L103)）。
- **`React.memo` + `contentVisibility: 'auto'` 组合优化长会话列表**：[MessageList.tsx:81-90](../components/MessageList.tsx#L81-L90) 用 CSS containment 避免屏幕外消息参与布局计算。
- **闭包陈旧值防护到位**：[useAgentSession.ts:534-549](../hooks/useAgentSession.ts#L534-L549) 用 `cancelled` 标志位 + AppShell 的 `sessionKey` remount 双保险处理 session 切换竞态。
- **FileViewer 大文件降级路径清晰**：超过 200KB / 5000 行自动切到自研虚拟化（[FileViewer.tsx:23-25](../components/FileViewer.tsx#L23-L25)）。
- **错误兜底完整**：所有 `fetch` 都有 `.catch`，EventSource 都有 cleanup。

### 问题与优化点

#### 🔴 严重（影响正确性 / 内存泄漏 / 安全）

- **`useFileTabs` 闭包陈旧导致关闭 tab 时选中错误的标签**
  - 位置：[useFileTabs.ts:24-36](../hooks/useFileTabs.ts#L24-L36)
  - 现象：`handleCloseFileTab` 中 `setActiveFileTabId` 的 callback 内使用了 `fileTabs`（来自外层闭包），而 `setFileTabs` 使用的是 `(prev) => ...`：
    ```ts
    setActiveFileTabId((cur) => {
      if (cur !== tabId) return cur;
      const remaining = fileTabs.filter((t) => t.id !== tabId);  // ← 闭包陈旧值
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
    ```
  - 风险：连续关闭多个 tab（或在外部 `setFileTabs` 未提交前快速关闭）时，`fileTabs` 仍是旧值，可能把 active 切到刚刚已被关闭的 id 上。
  - 建议：把两个 setState 合并到一次 `setFileTabs((prev) => {...})` 中：
    ```ts
    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      setActiveFileTabId((cur) =>
        cur !== tabId ? cur : next.length ? next[next.length - 1].id : null
      );
      if (next.length === 0) onAllTabsClosed?.();
      return next;
    });
    ```

- **`ChatInput` 卸载时 `URL.createObjectURL` 创建的预览 URL 不会释放**
  - 位置：[ChatInput.tsx:118-129](../components/ChatInput.tsx#L118-L129)（创建），[removeImage](../components/ChatInput.tsx#L135-L143) / [clearImages](../components/ChatInput.tsx#L145-L151)（释放）
  - 现象：`previewUrl` 仅在 `removeImage` / `clearImages` 中 revoke，但组件卸载时既不会调用 `clearImages`，也不会 revoke 残留 URL。
  - 风险：长会话使用中内存会持续上涨。
  - 建议：
    ```ts
    useEffect(() => () => {
      attachedImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    }, []);
    ```

- **`ChatMinimap` 在 `useMemo` 内读取 `containerRef.current?.clientHeight`（SSR/首次渲染时退化为 600，且属副作用外泄）**
  - 位置：[ChatMinimap.tsx:200-225](../components/ChatMinimap.tsx#L200-L225)
  - 现象：`const minimapHeightPx = containerRef.current?.clientHeight ?? 600;` 写在组件 body（每次渲染都执行），然后 `useMemo([..., minimapHeightPx])` 依赖它。
  - 建议：把高度测量移到 `useState + useEffect + ResizeObserver`，依赖项改为 state。

- **`ChatWindow` 包装 `handleAgentEvent` 的 Effect 会嵌套调用并丢失原 handler**
  - 位置：[ChatWindow.tsx:100-114](../components/ChatWindow.tsx#L100-L114)
  - 现象：`origHandler` 是 `handleAgentEventRef.current` 的快照（每次渲染都拿新值），该 effect 几乎每次渲染都会重跑，把 ref 又覆盖为"包装了快照"的新函数。若在 effect 重跑期间 `useAgentSession` 又更新了 ref，包装层会基于"上一版快照"调用，跳过最新 handler。
  - 建议：用单一稳定的事件总线模式 —— 在 `useAgentSession` 内部把"完成回调"作为 option 注入：
    ```ts
    useAgentSession({ ..., onAgentEndEvent: () => { if (soundEnabled) playDoneSound(); } });
    ```

#### 🟡 中等

- **AppShell 通过 window 自定义事件传递 stats / contextUsage（事件总线反模式）**
  - 位置：[AppShell.tsx:84-94](../components/AppShell.tsx#L84-L94) 派发 → [StatsBar.tsx:36-50](../components/StatsBar.tsx#L36-L50) 监听；另见 [ChatWindow.tsx:115-125](../components/ChatWindow.tsx#L115-L125) 的 `pi-connection-status`。
  - 风险：事件名魔法字符串（无类型约束）、无法被 React DevTools 追踪、多实例时全局污染、StatsBar 卸载顺序敏感。
  - 建议：改成 AppShell 持有 `sessionStats / contextUsage` state，直接 prop 传给 StatsBar。

- **AppShell 键盘快捷键 effect 依赖项过多，每次依赖变化都重绑全局监听**
  - 位置：[AppShell.tsx:235-296](../components/AppShell.tsx#L235-L296)
  - 建议：把 handler 用 ref 化（`handlerRef.current = handler` 每次渲染赋值），effect 依赖 `[]`，监听器内 `handlerRef.current(e)`。

- **`BranchNavigator` 与 AppShell 之间通过 `ref` 传递回调函数**
  - 位置：[AppShell.tsx:58-72](../components/AppShell.tsx#L58-L72)（`branchLeafChangeFnRef`）
  - 建议：要么把 active leaf id 完全提升到 AppShell，要么用 `useContext` 暴露 branch API。

- **`useAgentSession` 单文件管理 20+ 个 useState，职责过重**
  - 位置：[useAgentSession.ts:53-87](../hooks/useAgentSession.ts#L53-L87)
  - 建议：把相关状态聚合为 2-3 个 reducer（如 `modelReducer`、`agentStateReducer`），session 切换只需 `dispatch({type: "reset"})`。

- **`FileViewer.tsx` 超过 1200 行，混合 5 种 viewer**
  - 位置：[FileViewer.tsx](../components/FileViewer.tsx)
  - 建议：拆分为 `FileViewer/` 子目录，每个 viewer 独立文件。

- **`FileViewer` SSE 监听器同时设置 `addEventListener("error")` 和 `.onerror`**
  - 位置：[FileViewer.tsx:309-313](../components/FileViewer.tsx#L309-L313)、[446-450](../components/FileViewer.tsx#L446-L450)、[774-778](../components/FileViewer.tsx#L774-L778)
  - 建议：删除 `addEventListener("error")`，只保留 `onerror`。

- **`MessageView` 流式期间每次 token 都触发 `setTps` + `setStreamingDurations`**
  - 位置：[MessageView.tsx:425-435](../components/MessageView.tsx#L425-L435)
  - 风险：高频流式（tps 50+）下每秒数十次 setState，触发整棵 MessageView 重渲染（含所有 BlockView 子树，未 memo）。
  - 建议：(a) 把 `BlockView` 子组件用 `React.memo` 包裹并稳定 props；(b) TPS 计算降频（用 `requestAnimationFrame` 或 500ms 节流）。

- **`ChatMinimap` scroll 时高频 setState（无节流）**
  - 位置：[ChatMinimap.tsx:131-148](../components/ChatMinimap.tsx#L131-L148)
  - 建议：用 `requestAnimationFrame` 节流，或直接操作 DOM style。

#### 🟢 轻微

- **`useAgentSession` 的 `handleAgentEvent` 每次重渲染都重建并写入 ref**（[useAgentSession.ts:228](../hooks/useAgentSession.ts#L228)）。违反"不要在渲染期间写 ref"惯例。
- **`ToolPanel` / `PresetSelector` / `ChatInput` / `ModelSelector` 多处重复的"点击外部关闭"逻辑**。建议抽成 `useClickOutside(ref, onOutside)` hook。
- **`Typewriter` 组件 caret blink 用 `setInterval` + `setState` 每 530ms 重渲染**（[ChatWindow.tsx:46-49](../components/ChatWindow.tsx#L46-L49)）。建议改用 CSS `@keyframes` 动画。
- **`useAudio` 每次播放都 `new AudioContext()`**（[useAudio.ts:26](../hooks/useAudio.ts#L26)）。建议模块级单例。
- **`useTheme` 没有持久化订阅其他 tab 的 `storage` 事件**（[useTheme.ts](../hooks/useTheme.ts)）。
- **`MessageView` 内部 `getToolPreview` 等辅助函数每次渲染重建**（[MessageView.tsx:655-668](../components/MessageView.tsx#L655-L668)）。
- **a11y：可点击的 `<div>` 普遍缺少 `role="button"` / `tabIndex` / `onKeyDown`**。例子：[ChatMinimap.tsx:265-282](../components/ChatMinimap.tsx#L265-L282)、[FileExplorer.tsx:114-145](../components/FileExplorer.tsx#L114-L145)。
- **CSS 变量与 Tailwind 类名混用**。[ChatWindow.tsx:212-213](../components/ChatWindow.tsx#L212-L213) 用 `className="bg-danger-bg"`，FileViewer 用 `style={{ background: "var(--bg-elevated)" }}`。建议明确约定。
- **`FileViewer` 大量 inline style 重复（status bar 三处几乎相同）**（[FileViewer.tsx:355-376](../components/FileViewer.tsx#L355-L376) 等）。建议抽 `<ViewerStatusBar>` 组件。
- **`AgentEvent` 类型过于宽泛**（[agent-events-manager.ts:1-4](../hooks/agent-session/agent-events-manager.ts#L1-L4) `interface AgentEvent { type: string; [key: string]: unknown }`）。建议定义判别联合。
- **`MessageList` 中 `MessageView` 与外层 div 使用相同 key**（[MessageList.tsx:62](../components/MessageList.tsx#L62)）。建议删掉内层 key。

### 性能瓶颈与优化机会

| 位置 | 问题 | 影响 | 建议 |
|---|---|---|---|
| [MessageView.tsx:425-435](../components/MessageView.tsx#L425-L435) | 流式 token 高频 `setTps` / `setStreamingDurations` | 每条 token 触发整棵 BlockView 重渲染（未 memo） | 子组件 `React.memo` + TPS 节流到 500ms |
| [ChatMinimap.tsx:131-148](../components/ChatMinimap.tsx#L131-L148) | scroll 无节流，每帧 setState | 滚动长会话时 minimap 抢帧 | `requestAnimationFrame` 节流 或 DOM 直操 |
| [MessageView.tsx:510-518](../components/MessageView.tsx#L510-L518) `SyntaxHighlighter` | 每条代码块都用 Prism 高亮 | 长代码 / 多代码块渲染慢 | 流式期间用纯 `<pre>`，`message_end` 后再高亮 |
| [FileViewer.tsx:60-105](../components/FileViewer.tsx#L60-L105) `diffLines` | Myers diff O((m+n)·d) | 大文件 diff 切换时卡顿（5000 行 ~200ms+） | 切 diff 时显示 loading；或换 `fast-diff` |
| [MessageList.tsx:23-32](../components/MessageList.tsx#L23-L32) | `nextUserIdx` / `nextAssistantIdx` O(n) 双 pass | 超长会话（1000+ 条）每次 messages 变化都重算 | 已有 `useMemo`，可接受 |

### 优先级建议（按 ROI 排序）

1. **修复 `useFileTabs` 闭包 bug**（🔴）：5 行改动。
2. **`ChatInput` 卸载时 revoke blob URL**（🔴）：10 行改动。
3. **`MessageView` 流式渲染优化**（🟡）：`React.memo` + TPS 节流。
4. **重构 `AppShell` 跨组件通信**（🟡）：去掉 3 个 `window.dispatchEvent(CustomEvent)` 和 `branchLeafChangeFnRef`。
5. **`AgentEvent` 改判别联合**（🟡）：消除 `as string` 断言链条。

---

## 第四章 · Electron 桌面端

### 模块概览

Pi Agent Desktop 的 Electron 壳采用经典的「主进程 = 守护进程 + 浏览器壳」结构：`main.ts` 作为主进程入口负责单例锁、端口选择、子进程生命周期、IPC、自动更新；`preload.ts` 通过 `contextBridge` 暴露最小化 API；`tray.ts` 提供托盘集成。生命周期/重启/端口/日志等逻辑已被合理拆分到独立模块，每个模块都配有 node:test 单元测试。整体设计干净、关注点分离良好，但在**渲染进程 CSP、preload listener 清理、日志轮转、sandbox** 等几处仍有明确改进空间。

### 优点

- **模块化彻底、可测试性强**：业务策略全部纯函数化并配测试，`main.ts` 只做编排。
- **子进程生命周期考虑周到**：`handleNextProcessExit` 区分 starting/ready/stopped 状态，`restart-policy.ts` 实现 60s 窗口内 3 次的重启节流；`isQuitting` 标志阻止清理期间的级联重启。
- **进程树 kill 跨平台正确**：Windows 走 `taskkill /PID xxx /F /T`、Unix 走 `pgrep -P` → `ps --ppid` 双兜底再递归 `SIGKILL`，真实 spawn 验证。
- **env 过滤白名单严格**：[env-filter.ts](../electron/env-filter.ts) 仅放行必要变量 + `PI_` 前缀。
- **导航/窗口拦截到位**：`will-navigate` 限定 `127.0.0.1:activePort`，`setWindowOpenHandler` deny 后 `shell.openExternal` 处理 http/https。
- **就绪检测双轨制**：同时监听 stdout `Ready` 关键字和 `/api/health` HTTP 轮询。

### 问题与优化点

#### 🔴 严重（安全 / 稳定性 / 数据丢失）

- **主窗口加载的 Next.js 应用未注入 CSP**
  - 位置：[main.ts:228-247](../electron/main.ts#L228-L247)（`webPreferences`）、[main.ts:266](../electron/main.ts#L266)（`showApp` 中 `loadURL`）、[app/layout.tsx](../app/layout.tsx)
  - 现象：`startup.html` 有 `<meta CSP>`，但通过 `loadURL` 加载的 Next.js 页面**没有**任何 CSP（Next.js 默认不下发 `Content-Security-Policy` 头，`app/layout.tsx` 也未声明）。`will-navigate` 只挡跳转，不挡注入。
  - 风险：渲染进程拿不到 Node 但能调到 preload 暴露的 `electronAPI`（包含 `quitAndInstall`、`selectDirectory`）。一旦某条 npm 供应链或本地 Next.js 路由被污染（XSS），任意 JS 可在渲染进程长期驻留——可枚举目录、诱导用户点「立即重启」安装恶意更新等。
  - 建议：在 `createWindow` 后立刻挂载 session 级 CSP：
    ```ts
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:" + activePort + "; img-src 'self' data:;"
          ],
        },
      });
    });
    ```

- **preload 暴露的 `ipcRenderer.on` 没 listener 清理机制**
  - 位置：[preload.ts:6-9](../electron/preload.ts#L6-L9)
  - 现象：`onUpdateAvailable` / `onUpdateDownloaded` 每被调用一次就向 `ipcRenderer` 注册一个新 listener，且**没有返回 dispose 函数**。
  - 风险：① 内存泄漏（渲染进程 listener 数无上限增长）；② 同一更新事件触发 N 次回调；③ 旧组件 unmount 后 listener 仍存活，闭包持有 setState。
  - 建议：
    ```ts
    onUpdateAvailable: (cb) => {
      const listener = (_e: unknown, info: { version: string }) => cb(info);
      ipcRenderer.on("update-available", listener);
      return () => ipcRenderer.off("update-available", listener);
    },
    ```

- **`autoUpdater` 回调里多处 `mainWindow!` 非空断言**
  - 位置：[main.ts:472-486](../electron/main.ts#L472-L486)
  - 现象：`update-downloaded` 事件里 `dialog.showMessageBox(mainWindow!, ...)`，但用户完全可能已经「关闭到托盘」。
  - 建议：`if (!mainWindow || mainWindow.isDestroyed()) return;` 守卫，或 fallback 到无父窗口版本。

#### 🟡 中等

- **`sandbox: true` 未启用**
  - 位置：[main.ts:240-242](../electron/main.ts#L240-L242)
  - 现象：只显式设了 `nodeIntegration: false`、`contextIsolation: true`，未启用 `sandbox`。
  - 建议：加 `sandbox: true`。当前 preload 只用 `contextBridge` + `ipcRenderer`，开启 sandbox 不会破坏功能。

- **`set-theme` IPC 通道无运行时类型校验**
  - 位置：[main.ts:317-322](../electron/main.ts#L317-L322)
  - 建议：`if (typeof isDark !== "boolean") return;` 早返回；同时考虑改用 `ipcMain.handle`。

- **`startup.html` 的 CSP 含 `'unsafe-inline'` 且为冗余**
  - 位置：[startup.html:5](../electron/startup.html#L5)
  - 建议：改为 `default-src 'none'; style-src 'unsafe-inline'; script-src 'self';`。

- **日志无轮转，长期运行会无限增长**
  - 位置：[main.ts:62-72](../electron/main.ts#L62-L72)（`writeLog` → `appendFileSync`）
  - 建议：引入 `electron-log`（自带按日 rotation）或简易 size-based 滚动。

- **`autoUpdater.autoDownload = true` 无用户授权**
  - 位置：[main.ts:451](../electron/main.ts#L451)
  - 风险：用户可能处于流量敏感环境被静默下载大文件；配合前述 CSP 漏洞，渲染进程 XSS 可触发 `quitAndInstall` 路径。
  - 建议：把 `autoDownload` 设为 `false`，先弹 dialog。

- **生产子进程 spawn 未指定 `windowsHide: true`**
  - 位置：[main.ts:181-190](../electron/main.ts#L181-L190)
  - 建议：`spawn(process.execPath, [serverScript], { ..., windowsHide: true })`。

- **`before-quit` 的 `cleanup()` 是同步阻塞 quit**
  - 位置：[main.ts:329-333](../electron/main.ts#L329-L333)、[main.ts:198-211](../electron/main.ts#L198-L211)
  - 风险：Windows 上 `taskkill /T` 递归 kill 可能 100~500ms，用户点退出后窗口卡死。
  - 建议：用 `will-quit` 事件 + 异步 `cleanup` 然后 `event.preventDefault()` + 手动 `app.quit()`；或加 timeout 兜底。

#### 🟢 轻微

- **`choosePort` 错误吞掉**（[port-selection.ts:13-18](../electron/port-selection.ts#L13-L18)）。建议只对 `EADDRINUSE` 继续，其他错误 rethrow。
- **`tray.ts` 跨平台图标处理薄弱**（[tray.ts:9-12](../electron/tray.ts#L9-L12)）。建议按 `process.platform` 选 `.ico`/`.png`。
- **`serverState` 缺少 `restarting` 状态**（[restart-policy.ts](../electron/restart-policy.ts)）。
- **`startupPageUrl` 用 `file://` + hash 传 `message`**（[main.ts:83-90](../electron/main.ts#L83-L90)）。建议错误信息分类。
- **`ipcMain.handle("select-directory")` 返回路径后渲染进程无校验**（[main.ts:297-307](../electron/main.ts#L297-L307)）。
- **`createWindow` 的 `titleBarStyle: "hidden"` 未做平台分支**（[main.ts:230-238](../electron/main.ts#L230-L238)）。
- **`mainWindow` 模块级 `let` 不利于测试**（[main.ts:32-39](../electron/main.ts#L32-L39)）。建议封装 `ApplicationState` 类。
- **`autoUpdater.checkForUpdates()` 只调用一次，无定时巡检**（[main.ts:489](../electron/main.ts#L489)）。
- **`getStartupFailureDisposition` 逻辑极简**（[startup-failure.ts:1-15](../electron/startup-failure.ts#L1-L15)）。建议按 `err.code` 映射中文 hint。
- **`will-attach-webview` 阻止未注册**（项目未用 `<webview>`，可选加固）。

### 安全加固专项清单

| 项目 | 状态 | 位置 / 说明 |
|---|---|---|
| `contextIsolation: true` | ✅ | [main.ts:241](../electron/main.ts#L241) |
| `nodeIntegration: false` | ✅ | [main.ts:240](../electron/main.ts#L240) |
| `sandbox: true` | ⚠️ 未启用 | [main.ts:240-242](../electron/main.ts#L240-L242) |
| `webSecurity: true`（默认） | ✅ 隐式 | 建议显式声明 |
| `allowRunningInsecureContent: false` | ✅ 隐式 | 默认 false |
| `preload` 经 `contextBridge.exposeInMainWorld` | ✅ | [preload.ts:3-11](../electron/preload.ts#L3-L11) |
| 渲染进程 CSP | ❌ 缺失 | 仅 startup.html 有 |
| `will-navigate` 拦截 | ✅ | [main.ts:282-286](../electron/main.ts#L282-L286) |
| `setWindowOpenHandler` 拦截 | ✅ | [main.ts:287-295](../electron/main.ts#L287-L295) |
| `will-attach-webview` 阻止 | ⚠️ 未注册 | 项目未用 `<webview>`，可选加固 |
| IPC 通道运行时入参校验 | ⚠️ 部分 | `set-theme` 缺校验 |
| `ipcMain.handle` vs `on`+`send` | ✅ | 请求-响应用 `handle`，单向通知用 `on` |
| preload listener 可清理 | ❌ | [preload.ts:6-9](../electron/preload.ts#L6-L9) 未返回 unsubscribe |
| `shell.openExternal` URL scheme 白名单 | ✅ | 仅 http/https |
| Env 变量过滤 | ✅ | [env-filter.ts](../electron/env-filter.ts) 白名单严格 |
| `requestSingleInstanceLock` | ✅ | [main.ts:17-19](../electron/main.ts#L17-L19) |
| 子进程在 `before-quit` 被杀 | ✅ | [main.ts:329-333](../electron/main.ts#L329-L333) |
| 进程树 kill（含孙进程） | ✅ | [process-tree.ts](../electron/process-tree.ts) |
| 自动更新签名校验 | ⚠️ | 依赖 electron-updater 默认行为 |
| 日志脱敏 | ✅ | env-filter 已防 API key 进入子进程 |
| `PermissionRequestHandler` | ⚠️ 未注册 | 可选加固 |
| 文件协议/远程内容隔离 | ✅ | startup.html CSP `default-src 'none'` |

### 优先级建议（按 ROI 排序）

1. **主窗口注入 CSP**（🔴）：单点改动，堵住 XSS→preload→`quitAndInstall` 的攻击链。
2. **preload 的 `ipcRenderer.on` 返回 unsubscribe**（🔴）：消除内存泄漏和重复回调。
3. **启用 `sandbox: true`**（🟡）：Electron 官方强烈推荐。
4. **日志轮转**（🟡）：用 `electron-log` 替换裸 `appendFileSync`。
5. **`autoUpdater` 增加用户授权 + `mainWindow` 守卫**（🟡）。

---

## 第五章 · 整体架构 / 构建 / 工程化

### 项目概览

Pi Agent Desktop 是 [pi coding agent](https://github.com/earendil-works/pi-coding-agent) 的个人极简桌面客户端，复用同一套 Next.js 14+ App Router + React 代码同时支持浏览器（:30141）和 Electron 桌面两种模式。生产模式通过 `ELECTRON_RUN_AS_NODE=1` 把 Electron 自身降级为 Node.js 启动 Next.js standalone `server.js` 子进程，主进程开 `BrowserWindow` 指向本地端口，进程内直接持有 `AgentSession` 并通过 SSE 单向推送事件到浏览器。整体设计干净、无状态库/UI 库依赖、文档质量在个人项目中属于顶级水准，但工程细节上存在若干安全假象、文档漂移、死代码和激进版本组合问题。

### 优点

- **架构文档顶级**：[docs/ARCHITECTURE.md](ARCHITECTURE.md) 786 行权威参考，含 Mermaid 流程图、状态机、陷阱清单（§14.1–14.10），分层（AGENTS.md 速查 → CLAUDE.md 指南 → ARCHITECTURE.md 深度）边界清晰。
- **CI 完善且双平台**：[.github/workflows/ci.yml](../.github/workflows/ci.yml) 覆盖 lint / typecheck / test / standalone build / **Windows 矩阵**，`concurrency.cancel-in-progress: true` 避免 PR 浪费。
- **关键路径有测试护栏**：覆盖 Fork 顺序、ToolCall 归一化、SSE 重连等核心场景。
- **globalThis 都用 `declare global { var ... }` 类型化**，HMR 安全且有 `process.once("exit", cleanup)` 资源回收。
- **双模式共享彻底**：Web 和 Desktop 共享 100% UI 与 API 代码，preload.ts 仅暴露 `onUpdateAvailable` / `quitAndInstall` 两个桥接 API，无 IPC 侵入业务逻辑。

### 问题与优化点

#### 🔴 严重（架构腐化 / 安全 / 阻碍演进）

- **`proxy.ts` 是死代码 —— 自以为有 CSP 保护，实际从未生效**
  - 位置：[proxy.ts](../proxy.ts)（整个文件）+ [next.config.ts](../next.config.ts)（未引用）
  - 现象：文件导出 `proxy()` 与 `config.matcher`，但 Next.js App Router **只识别根目录的 `middleware.ts`**，命名为 `proxy.ts` 永远不会被加载。grep 全仓 `from "@/proxy"` / `require("...proxy")` 零引用。
  - 影响：CSP 头（`default-src 'self'`、`script-src` 限制等）**从未注入任何响应**，整个应用运行在浏览器默认策略下，存在 XSS、`connect-src` 任意外发风险；这是**安全假象** —— 维护者以为有防护。
  - 建议：要么 `mv proxy.ts middleware.ts` 让 Next.js 自动识别；要么删除文件并在文档中明确说明"不做服务端 CSP，依赖 Electron 的 BrowserWindow webPreferences"。二选一，不能保留当前状态。

- **`AGENTS.md` / `CLAUDE.md` / ARCHITECTURE.md §14.1 都说"三个 globalThis"，实际有五个**
  - 位置：
    - 文档：[AGENTS.md](../AGENTS.md) "三个必须存 globalThis" 段、[docs/ARCHITECTURE.md:317-321](ARCHITECTURE.md) §14.1 表格
    - 实际：`__piSessions`、`__piStartLocks`、`__piSessionPathCache`（[lib/rpc-manager.ts:278](../lib/rpc-manager.ts#L278)、[lib/session-reader.ts:46](../lib/session-reader.ts#L46)）+ **未记录的** `__piWriteLocks`（[lib/session-lock.ts:22](../lib/session-lock.ts#L22)）+ `__piAllowedRootsCache`（[app/api/files/[...path]/route.ts:109](../app/api/files/[...path]/route.ts#L109)）
  - 影响：维护者依据文档排查"哪个全局变量持有状态"时会遗漏文件锁和路径白名单缓存，HMR 调试、`process.exit` cleanup 设计、内存分析都会漏点。
  - 建议：把三个文档统一更新为"五个 globalThis"，并在 §14 加一张表列出 `变量名 | 模块 | 用途 | TTL/回收策略`。

- **双锁文件并存：`package-lock.json` + `bun.lock`**
  - 位置：仓库根 `package-lock.json`、`bun.lock` 并存；CI（[.github/workflows/ci.yml:25](../.github/workflows/ci.yml#L25)）用 `npm ci`
  - 影响：`npm ci` 严格按 `package-lock.json` 安装，但 `bun.lock` 在仓库里会让贡献者误以为项目用 Bun。两边锁版本不一致时会出现"在我机器上能跑"的依赖漂移。
  - 建议：选定单一包管理器（CI 是 npm，建议统一 npm），删除 `bun.lock` 并在 `.gitignore` 加 `bun.lock`；或在 README 顶部声明"Bun 开发 / npm CI"的混合策略并加 `engines.packageManager` 字段。

- **激进版本组合：Next.js 16.2.1 + React 19.2.4 + Electron 36 + @types/node 25 + node 24**
  - 位置：[package.json:33-52](../package.json#L33)、[.github/workflows/ci.yml:16](../.github/workflows/ci.yml#L16)
  - 现象：Next.js 16 / React 19 / Electron 36 都是非 LTS 的最新主版本；`@types/node: ^25` 比 CI 的 `node-version: "24"` 高一个主版本，Node 24 的 API 在 types 25 里可能被标记为已弃用或签名变化。
  - 影响：上游 pi-coding-agent SDK 的 peer 范围未必跟上；@types/node 高于运行时是已知的"未来 API 漏到今天编译过、运行时崩"反模式；Electron 36 的原生模块每次升级都可能引发 ABI 不兼容。
  - 建议：`@types/node` 锁定到 `^24`（与运行时对齐）；在 `package.json` 加 `"engines": { "node": ">=20 <25" }`；为 pi SDK 设置可观察的 peer 检查。

#### 🟡 中等

- **eslint flat config 关闭了 Next.js 16 + React Compiler 的核心规则**
  - 位置：[eslint.config.mjs:14-18](../eslint.config.mjs#L14-L18)
  - 现象：`react-hooks/immutability` / `react-hooks/refs` / `react-hooks/set-state-in-effect` 全部 `off`。这些是 Next 16 配合 React Compiler 引入、用于捕获 effect 中 setState、ref mutation 等真正会引发 stale closure / 无限渲染的规则。
  - 影响：失去 React 19 升级的最大静态护栏；后续打开 React Compiler 时会一次性爆出大量违规。
  - 建议：至少保留 `set-state-in-effect` 为 `warn`。

- **`lib/panel-layout.js` 是 CJS 文件混在 ESM 项目中**
  - 位置：[lib/panel-layout.js](../lib/panel-layout.js)（全文 `module.exports =`），被 [hooks/usePanelLayout.ts:4](../hooks/usePanelLayout.ts#L4) 以 `@/lib/panel-layout` 导入
  - 建议：改为 `panel-layout.ts` 并加 `export function`。

- **`electron-builder.yml` 手动列举 20+ 个 `electron-updater` 传递依赖作为 extraResources**
  - 位置：[electron-builder.yml:21-55](../electron-builder.yml#L21-L55)
  - 现象：`electron-updater` / `builder-util-runtime` / `fs-extra` / `jsonfile` / `js-yaml` / `lazy-val` / `lodash.escaperegexp` / `lodash.isequal` / `semver` / `tiny-typed-emitter` / `universalify` / `debug` / `sax` / `argparse` / `ms` 全部手抄进 extraResources
  - 影响：electron-updater 任何一次升级如果新增/移除依赖，自动更新功能就会在生产环境运行时 `Cannot find module`，且只在用户机器上崩，CI 抓不到。
  - 建议：要么用 `files: ["node_modules/electron-updater/**/*"]` 让 electron-builder 自动追踪整个子树，要么写一个 prebuild 脚本 `npm ls --json electron-updater` 生成此段。

- **缺 e2e / 集成测试 —— 关键路径仅单元覆盖**
  - 位置：整个 [test/](../test/) 仅 1 个临时脚本；所有 `*.test.ts` 都是纯函数/纯 hook 单测
  - 影响：Fork 的"预注册→销毁旧 wrapper"契约、SSE 断线重连、Electron 启动 `server-wait` 双重探测这些**跨模块**关键流程没有端到端护栏。
  - 建议：补一组 Playwright/Supertest 覆盖：(1) 发送 prompt → SSE 收到 agent_end；(2) POST fork → 旧 session 不可达、新 session 可达；(3) 启动 Next.js 子进程 → `/api/health` 200。

- **生产环境无错误监控 / 崩溃上报**
  - 位置：[electron/main.ts](../electron/main.ts) 全文无 `crashReporter`、无 Sentry/Telemetry
  - 影响：用户机器上 Node 子进程崩溃、`autoUpdater` 失败、Next.js server.js 异常退出，开发者完全感知不到。
  - 建议：集成 Electron 内置 `crashReporter.start({ uploadToServer: false })` 写本地 minidump，或接入 Sentry Electron（注意脱敏 prompt 内容）。

- **TS 严格度可进一步提升**
  - 位置：[tsconfig.json:6-20](../tsconfig.json#L6-L20) 只开了 `strict: true`
  - 缺失：`noUncheckedIndexedAccess`（频繁访问 `messages[i]` / `entryIds[i]` 这种平行数组时尤其重要）、`exactOptionalPropertyTypes`、`noFallthroughCasesInSwitch`、`noImplicitReturns`、`forceConsistentCasingInFileNames`
  - 建议：先打开 `noUncheckedIndexedAccess`，分两次提交清错。

#### 🟢 轻微

- **`tsconfig.tsbuildinfo` 被提交进仓库**。建议 `.gitignore` 加 `*.tsbuildinfo` 并 `git rm --cached`。
- **`test/tmp-test.mjs` 是临时调试脚本**。建议删除或挪到 `scripts/debug/`。
- **`data/state_store.db/` 是运行时产物**（SQLite 内存数据库的磁盘映射）。建议 `git rm -r data/` 并 `.gitignore` 加 `/data/`。
- **`image-2.png` 散落在仓库根**。建议移到 `public/screenshot.png` 并改 README 路径。
- **eslint flat config 缺 type-aware 配置**。建议补 typescript-eslint `typeChecked` 选项并打开 `no-floating-promises`。
- **没有 Prettier 配置**。建议加 `.prettierrc` 最小配置 + `eslint-config-prettier`。
- **README 项目结构段落与实际目录有出入**（只列了 8 个 API + 4 个 lib 文件）。
- **`bin/pi-web.js` 中 next 二进制查找逻辑重复**（三层 try/catch fallback）。

### 文档一致性核查

| 文档声明 | 实际情况 | 结论 |
|---|---|---|
| ARCHITECTURE.md 顶部 "v0.7.11" | [package.json:4](../package.json#L4) `0.7.13` | ❌ 版本号滞后 2 个 patch |
| ARCHITECTURE.md "pi-coding-agent ^0.78.0 / pi-ai ^0.78.0" | [package.json:34-35](../package.json#L34) 实际 `^0.79.8` | ❌ SDK 版本滞后 |
| ARCHITECTURE.md §15 "Next.js 16.2.1" | package.json `next: 16.2.1` | ✅ |
| "24 条 API 路由"（AGENTS.md / ARCHITECTURE.md §12） | file_search 实测 24 个 `route.ts` | ✅ 完全一致 |
| "17 个顶层组件"（ARCHITECTURE.md §10） | list_dir 实测 16 个 `.tsx` + `file-viewer-virtualization.ts` | ⚠️ 数 16 + 1 算法文件，文档把算法文件计入"组件"，需明确口径 |
| "agent-session/ 子 hooks 8 个"（ARCHITECTURE.md §11） | 8 个 `.ts` 但其中 5 个是纯函数非 React hook | ⚠️ 措辞误导 |
| "三个必须存 globalThis"（AGENTS.md / CLAUDE.md / ARCHITECTURE.md §14.1） | 实际 5 个：+ `__piWriteLocks` + `__piAllowedRootsCache` | ❌ 漏 2 个 |
| README "项目结构" 段落 | 缺 `hooks/` `bin/` `data/` `build/` `release/` `proxy.ts` 等 | ⚠️ 严重不全 |
| ARCHITECTURE.md §14.6 extraResources 描述 | [electron-builder.yml:11-20](../electron-builder.yml#L11-L20) 完全一致 | ✅ |
| "两套 compaction 事件"（ARCHITECTURE.md §14.9） | grep `auto_compaction_start` 与 `compaction_start` 双接受 | ✅ |

**关键不一致**：版本号 2 处过时、globalThis 计数 3 处错误（影响维护）、README 项目结构不全。

---

## 综合改进路线图

> 综合 5 大领域的发现，给出按时间维度的整改路线图。每条都标注来源章节以便回溯。

### 🔥 立即处理（本周内，安全与正确性）

> 这些是**已经在生产环境暴露风险**或**确定性 bug**，改动成本极低，收益极高。

| # | 任务 | 来源 | 预计成本 |
|---|---|---|---|
| 1 | `proxy.ts → middleware.ts` 重命名，让 Next.js CSP 真正生效 | [§5 🔴1](#--appapi-路由层) | 5 分钟 |
| 2 | `useFileTabs` 闭包 bug 修复（合并 setState） | [§3 🔴1](#--前端-components--hooks) | 10 分钟 |
| 3 | `ChatInput` 卸载时 revoke blob URL | [§3 🔴2](#--前端-components--hooks) | 10 分钟 |
| 4 | Electron 主窗口注入 CSP（`onHeadersReceived`） | [§4 🔴1](#--electron-桌面端) | 30 分钟 |
| 5 | preload `ipcRenderer.on` 返回 unsubscribe | [§4 🔴2](#--electron-桌面端) | 30 分钟 |
| 6 | Fork 失败 catch 块加 `unlink` 清理孤儿文件 | [§2 🔴3](#--lib-服务端库) | 10 分钟 |
| 7 | 删除死代码：`test/tmp-test.mjs`、`data/state_store.db/`、`tsconfig.tsbuildinfo` | [§5 🟢](#--整体架构--构建--工程化) | 5 分钟 |

### 🚀 短期（1–2 周，纯清理）

| # | 任务 | 来源 |
|---|---|---|
| 1 | 落地 `middleware.ts` Origin/Host 校验 + CSRF token（堵住远程攻击面根因） | [§1 🔴1](#--appapi-路由层) |
| 2 | `/api/agent/new` 与 `/api/files` 的 cwd 白名单收敛（拒绝根/家/系统目录） | [§1 🔴2-4](#--appapi-路由层) |
| 3 | `/api/skills/install` 加 `pkg` 字符集白名单 | [§1 🔴3](#--appapi-路由层) |
| 4 | SSE `/api/agent/[id]/events` 补 `cancel()` + 主动关闭检测 | [§1 🟡1](#--appapi-路由层) |
| 5 | `?includeState` 路径与 `send` 解耦，避免观测请求触发 idle timer 复位 | [§1 🟡2](#--appapi-路由层) |
| 6 | 启用 Electron `sandbox: true` | [§4 🟡1](#--electron-桌面端) |
| 7 | 同步文档版本号（v0.7.11 → 0.7.13；pi ^0.78.0 → ^0.79.8）；补 globalThis 表格（三个 → 五个） | [§5 🔴2 + 文档核查](#--整体架构--构建--工程化) |
| 8 | 锁定单一包管理器（删除 `bun.lock` 或声明混合策略） | [§5 🔴3](#--整体架构--构建--工程化) |
| 9 | `prompt`/`steer`/`followUp` 错误通道：catch 时推送 `agent_error` SSE 事件 | [§2 🔴1](#--lib-服务端库) |

### 🎯 中期（1–2 月，工程化升级）

| # | 任务 | 来源 |
|---|---|---|
| 1 | 补 e2e 测试：Playwright 覆盖 prompt→SSE→agent_end、fork 旧 session 失活、Electron 启动 `/api/health` | [§5 🟡4](#--整体架构--构建--工程化) |
| 2 | 补 `session-reader.test.ts`：`buildSessionContext` compaction 分支 + `getSessionEntriesAsync` CRLF/BOM | [§2 测试](#测试覆盖评估) |
| 3 | `getSessionEntriesAsync` 改流式读取（`readline.createInterface`） | [§2 🟡1](#--lib-服务端库) |
| 4 | TS 严格度提升：先开 `noUncheckedIndexedAccess`，再开 `noImplicitReturns` / `noFallthroughCasesInSwitch` | [§5 🟡6](#--整体架构--构建--工程化) |
| 5 | electron-builder extraResources 自动化（prebuild 脚本读 `npm ls --json electron-updater`） | [§5 🟡3](#--整体架构--构建--工程化) |
| 6 | 接入错误监控：Electron `crashReporter` 本地 minidump + 可选 Sentry | [§5 🟡5](#--整体架构--构建--工程化) |
| 7 | type-aware ESLint：打开 `@typescript-eslint/no-floating-promises` | [§5 🟢](#--整体架构--构建--工程化) |
| 8 | 前端性能：`BlockView`/`TextBlock` 加 `React.memo` + TPS 节流 | [§3 性能](#性能瓶颈与优化机会) |
| 9 | 重构 `AppShell` 跨组件通信：去掉 3 个 `window.dispatchEvent(CustomEvent)` | [§3 🟡1](#--前端-components--hooks) |
| 10 | 删除 `set_thinking_level` deepseek 硬编码 hack，推动上游 pi 修复 | [§2 🔴2](#--lib-服务端库) |
| 11 | 日志轮转（`electron-log`）+ `autoUpdater.autoDownload = false` + `mainWindow` 守卫 | [§4 🟡](#--electron-桌面端) |
| 12 | `AgentEvent` 改判别联合，消除 `as string` 断言链 | [§3 🟢](#--前端-components--hooks) |

### 🌟 长期（3–6 月，架构演进）

| # | 任务 | 来源 |
|---|---|---|
| 1 | **目录边界形式化**：`lib/` 拆为 `lib/server/` 与 `lib/shared/`，用 ESLint `no-restricted-imports` 阻止 `components/` 直接 import `lib/server/*` | 综合建议 |
| 2 | **panel-layout.js → .ts + 全仓 CJS 清零**，为 Turbopack/Edge Runtime 留空间 | [§5 🟡2](#--整体架构--构建--工程化) |
| 3 | **版本组合下沉到 LTS**：等 Next.js / React / Electron 当前的 latest 进入稳定期后再升；`@types/node` 与 CI Node 版本严格对齐 | [§5 🔴4](#--整体架构--构建--工程化) |
| 4 | **状态机形式化**：用 XState 或自写显式状态机统一管理 `idle → streaming → compacting → forking` 全生命周期 | 综合建议 |
| 5 | **跨进程文件锁**：用 `proper-lockfile` 或 OS 级 flock 替代进程内 Promise 锁，防御 Electron 主进程 + Next.js 子进程并发写 | [§2 🟡5](#--lib-服务端库) |
| 6 | **CI 增加依赖审计与 lockfile 一致性检查**：`npm audit --audit-level=high` + `npm ls --omit=dev` 校验 extraResources 子树完整性 | 综合建议 |
| 7 | **FileViewer 拆分**：1200+ 行单文件按 viewer 类型拆为子目录 | [§3 🟡5](#--前端-components--hooks) |

---

## 附录：审查方法与覆盖范围

### 审查方法

本次审查采用**并行多领域 subagent 模式**：

- **5 个 subagent 同时作业**，每个聚焦一个独立模块，避免上下文互相干扰
- **模型**：GLM-5.2 (CodingPlan)
- **每个 subagent 指令**包含：审查范围（精确到文件）、项目背景、审查重点（10+ 条）、统一输出格式（🔴/🟡/🟢 + 位置/现象/风险/建议）
- **审查深度**：subagent 自主用 `read_file` / `list_dir` / `grep_search` 阅读所有目标文件，定位到行号

### 覆盖范围统计

| 领域 | 文件数 | 报告章节 |
|---|---|---|
| `app/api/` | 24 个 `route.ts` | 第一章 |
| `lib/` | 14 个 `.ts` + 1 个 `.js` + 对应测试 | 第二章 |
| `components/` + `hooks/` | 17 个组件 + 6 个 hook + 8 个子 hook | 第三章 |
| `electron/` | 10 个 `.ts` + 配置 + 测试 | 第四章 |
| 配置 / 文档 / 测试体系 | `package.json`、`next.config.ts`、`electron-builder.yml`、`tsconfig.json`、CI、`docs/` | 第五章 |

### 引用约定

- 所有 `路径:行号` 引用基于审查时的 `main` 分支快照
- `../xxx` 前缀表示从 `docs/` 目录回到项目根的相对路径（在 VS Code / GitHub 中可点击跳转）
- 文档内的 markdown 链接（如 [rpc-manager.ts](../lib/rpc-manager.ts)）已按 workspace-relative 路径规范生成

### 后续行动建议

1. **本报告作为 issue 拆分依据**：每个 🔴 严重项可独立创建 GitHub issue，标签 `security` / `bug` / `tech-debt`
2. **优先处理"立即处理"清单**：本周内 7 项小改动即可大幅降低风险面
3. **定期复审**：建议每季度跑一次类似审查，跟踪整改进度与新增技术债

---

*本报告由 5 个 GLM-5.2 subagent 并行生成，人工整合校对于 2026-06-22。*
