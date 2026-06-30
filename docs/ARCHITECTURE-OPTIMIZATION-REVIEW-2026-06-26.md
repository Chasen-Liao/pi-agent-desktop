# Pi Agent Desktop 架构优化审查报告（2026-06-26）

> **审查日期**：2026-06-26  
> **审查基线**：当前工作区，`package.json` v0.7.16  
> **审查范围**：Next.js App Router API、`lib/` 服务端会话层、React components/hooks、Electron 主进程与打包配置、文档一致性  
> **说明**：本轮按用户要求派出多个 subagent。前两次 subagent 调度因工作区 credits 不足失败；随后重新派出 2 个 subagent，分别完成 Electron/打包/工程化与前端组件/hooks/状态流审查。主 agent 基于 subagent 结果和本地源码核查整合本报告。

---

## 结论摘要

当前项目不是“缺架构”的状态，而是已经进入了第二阶段：核心边界清晰、关键风险多处已被修复，但部分模块开始出现**状态边界膨胀、运行时依赖维护成本、文档漂移与跨模块契约测试不足**。因此近期优化不应走大重构路线，建议优先做小而可验证的边界收敛。

最值得近期处理的 5 件事：

1. **拆薄 `hooks/useAgentSession.ts` 的 orchestration 层**：它现在同时持有会话加载、SSE 事件处理、发送命令、模型/工具/thinking 状态、压缩、fork、导航等职责，已成为前端状态中心。
2. **替换 `AppShell`/`StatsBar` 的 `window.dispatchEvent(CustomEvent)` 桥接**：这条隐式全局事件总线可维护性弱，建议收敛为 props、context 或一个小型局部 store。
3. **让 Electron 打包运行时依赖可生成/可验证**：`electron-builder.yml` 手写 15+ 个 `electron-updater` 传递依赖，升级时容易生产环境缺模块。
4. **补跨模块集成测试**：现有单测覆盖很多纯逻辑，但缺少 prompt/SSE/fork/Electron packaged server 这类契约级验证。
5. **更新或归档旧审查报告**：`docs/ARCHITECTURE-REVIEW.md` 是 2026-06-22 基线，包含多项当前已修复的问题，继续作为“当前风险报告”会误导维护。

两个 subagent 的共同结论也很一致：当前最需要优化的是**隐式契约显式化**。前端侧是 window event、手动 reset、固定 50ms 延迟；Electron 侧是 updater IPC 状态、stdout ready 判定、手写依赖闭包。它们不是必须立刻大改的架构错误，但都属于“现在还能靠经验维护，后续会靠事故暴露”的边界问题。

---

## 审查事实

| 项目 | 当前证据 |
|---|---|
| API 路由数量 | `app/api` 下 24 个 `route.ts` |
| 组件规模 | `components` 下 30 个 `.tsx` |
| hooks 规模 | `hooks` 下 20 个 `.ts/.tsx` |
| Electron TS 文件 | `electron` 下 17 个 `.ts` |
| 版本 | `package.json` v0.7.16，Next.js 16.2.1，React 19.2.4，Electron 36.9.5 |
| 既有报告 | `docs/ARCHITECTURE-REVIEW.md` 存在，但基线为 v0.7.13 / 2026-06-22 |
| 未提交改动 | 当前工作区已有 `electron/startup.html` 修改，本报告未触碰该文件 |

---

## 优先级路线图

### P0：近期值得做（低风险、高收益）

| 优化项 | 目标 | 主要文件 | 验证方式 |
|---|---|---|---|
| 收敛 `useAgentSession` 职责 | 降低前端状态中心复杂度 | `hooks/useAgentSession.ts`、`hooks/agent-session/*` | `npm run test`，重点跑 `hooks/agent-session/*.test.ts` |
| 去掉全局 CustomEvent 统计桥 | 消除隐式依赖 | `components/AppShell.tsx`、`components/ChatWindow.tsx`、`components/StatsBar.tsx` | 新增/调整组件测试，手测 stats/context usage 更新 |
| 打包依赖自动校验 | 防止 Electron 生产缺模块 | `electron-builder.yml`、新增脚本可选 | `npm run dist` 或至少 `npm run pack` 后检查 `resources/app/node_modules` |
| 给 `quitAndInstall` 加主进程状态门禁 | 防止未下载更新时触发安装路径 | `electron/main.ts`、`electron/preload.ts` | mock `autoUpdater`，验证未下载时不调用 `quitAndInstall()` |
| 强化 packaged readiness 判定 | 避免 stdout `Ready` 误判服务已就绪 | `electron/server-wait.ts`、`electron/main.ts` | 测试 stdout ready 但 health 失败时不 resolve |
| 给旧报告加状态说明或归档 | 避免维护误导 | `docs/ARCHITECTURE-REVIEW.md` | 人工核对旧报告不再被当作当前事实 |
| 补少量集成测试 | 锁住跨模块契约 | `app/api/agent/*`、`lib/rpc-manager.ts`、Electron 启动流程 | 新增 node:test 或 Playwright/Supertest |

### P1：短期演进（1-2 周）

| 优化项 | 目标 | 风险 |
|---|---|---|
| 为 session path cache 增加负缓存/限流 | 避免随机 sessionId 触发全量扫描 | 需要确认不会影响新 session 立刻可见 |
| 将 file route 的 list/read/watch/put 拆出纯函数 | 降低 `app/api/files/[...path]/route.ts` 端点复杂度 | 拆分时要保持 Windows 路径兼容测试 |
| 为 `AgentEvent` 服务端与客户端事件建立契约测试 | 降低 SDK 事件形状变化带来的 UI 挂起风险 | 需要 mock pi 事件流 |
| 给 Electron CSP 与 middleware CSP 建共享常量 | 避免策略漂移 | 注意 Electron active port 动态注入 |

### P2：长期演进（1-3 月）

| 优化项 | 目标 | 适用条件 |
|---|---|---|
| `lib/server` / `lib/shared` 目录边界形式化 | 防止浏览器端误 import server-only 模块 | 当团队协作或模块继续增长时 |
| 会话状态机形式化 | 统一 idle/streaming/compacting/forking/retrying | 当前状态分散导致 bug 时 |
| Electron packaged e2e | 覆盖真实 standalone server + BrowserWindow | 发布频率提升后 |
| 文档事实自动检查 | 避免版本号、API 数量、globalThis 表格漂移 | 文档继续作为权威参考时 |

---

## 详细发现

### 1. 前端会话主 hook 已成为过宽 orchestration 层

**证据**

- `hooks/useAgentSession.ts:48` 定义主 hook。
- `hooks/useAgentSession.ts:71` 起集中管理大量状态：`agentRunning`、模型列表、thinking level、工具 preset、retry、context usage、system prompt、forking、compaction、phase 等。
- `hooks/useAgentSession.ts:134` 起处理 SSE agent 事件。
- `hooks/useAgentSession.ts:239` 起处理发送消息、新会话创建、工具 preset、模型与图片等。
- `hooks/useAgentSession.ts:516` 起 session change effect 重置大量 session-scoped 状态，并在 `hooks/useAgentSession.ts:570` 显式禁用 exhaustive deps。

**风险/成本**

这个文件现在是“前端会话控制器”，不是单纯 hook。它的风险不是行数本身，而是多个状态子域共享同一个 effect 和 callback 闭包：session 切换、SSE 重连、compaction、fork、model override 任一改动都可能影响另一个域。禁用 deps 的 effect 目前有明确注释，但也说明该区域已经依赖人工维护闭包正确性。

**建议**

近期不要整体重写。建议先按已有 `hooks/agent-session/` 模式继续小步拆分：

- `use-session-commands.ts`：封装 `handleSend`、`handleAbort`、`handleSteer`、`handleFollowUp`。
- `use-session-model-tools.ts`：封装 model list、tool preset、thinking level。
- `use-session-lifecycle-reset.ts`：集中 session 切换时的状态重置，保持一个明确输入 `sessionId`。
- `useAgentSession.ts` 保留为组合层，只做 wiring。

**验证**

- 跑 `npm run test`。
- 重点跑 `hooks/agent-session/agent-events-manager.test.ts`、`stream-state.test.ts`、`session-loader-api.test.ts`。
- 手测：新建会话、切换旧会话、发送消息、fork、compact、切换 model/tool preset。

**优先级**

近期值得做。它不是功能 bug，但会持续放大后续维护成本。

---

### 2. `AppShell` 与 `StatsBar` 使用全局 CustomEvent 桥接，边界隐式

**证据**

- `components/AppShell.tsx:88` 通过 `window.dispatchEvent(new CustomEvent("pi-session-stats", ...))` 传递 stats。
- `components/AppShell.tsx:95` 通过 `window.dispatchEvent(new CustomEvent("pi-context-usage", ...))` 传递 context usage。
- `components/StatsBar.tsx:31` 起监听这两个 window event。
- `components/ChatWindow.tsx:165` 起又通过 props 把 stats/context usage 推回 `AppShell`，形成 props 与 window event 混合链路。
- `hooks/agent-session/agent-events-manager.ts:48` 也用 `window.dispatchEvent("pi-connection-status")` 广播连接状态。

**风险/成本**

这相当于一个未命名的全局事件总线。类型约束弱，调用链不可从 React 组件树直接看出，未来如果页面出现多个 ChatWindow 或嵌入式视图，事件会天然广播到全局。测试也需要 mock window event，而不是验证组件 props。

**建议**

先处理 stats/context usage：

- 把 `StatsBar` 改为接收 `sessionStats`、`contextUsage` props。
- `AppShell` 保存来自 `ChatWindow` 的 stats/context usage state，而不是 dispatch window event。
- 连接状态可以暂时保留，因为它由 `AgentEventsManager` 发出，后续可改为 `useSyncExternalStore` 或直接由 `useAgentEvents` 返回。

**验证**

- 为 `StatsBar` 增加纯 props 渲染测试。
- 手测 agent 结束后 stats 与 context usage 在顶部栏更新。

**优先级**

近期值得做。改动面小，收益是组件边界更显式。

---

### 3. Fork 后用固定 `setTimeout(50)` 刷新会话树，存在时间假设

**证据**

- `components/AppShell.tsx:187` 定义 `handleSessionForked`。
- `components/AppShell.tsx:191` 使用 `setTimeout(async () => { fetch("/api/sessions") ... }, 50)` 等待会话注册刷新。
- 服务端 `lib/rpc-manager.ts:192` 起 fork 分支已做到新 wrapper 预注册，`lib/rpc-manager.ts:239` 调用 `startRpcSession(newSessionId, ...)`，`lib/rpc-manager.ts:484` 写入 registry。

**风险/成本**

前端的 50ms 是经验值。当前可能大部分时候可用，但它把“磁盘 session 列表刷新可见”建模为时间，而不是服务端返回契约。机器慢、杀毒软件扫描、会话目录较大时，偶发无法自动选中新 fork 会话。

**建议**

让 fork 返回的数据更完整，避免再拉列表竞态：

- 服务端 `send("fork")` 已返回 `newSessionId`，可以进一步让 API route 或客户端在成功后直接调用 `GET /api/sessions/[id]` 获取单个 session info。
- 如果必须刷新列表，则改为重试直到列表包含 `newSessionId` 或超时，例如 5 次指数退避，而不是固定 50ms。

**验证**

- 为 `handleSessionForked` 提取纯函数或加组件测试，模拟第一次 `/api/sessions` 未包含新 id、第二次包含。
- 手测 fork 后自动跳转。

**优先级**

近期可做，属于正确性加固。

---

### 4. 服务端 session path cache 缺少负缓存，随机 id 会触发全量扫描

**证据**

- `lib/session-reader.ts:14` `listAllSessions()` 调用 `SessionManager.listAll()` 并填充 path cache。
- `lib/session-reader.ts:50` `resolveSessionPath(sessionId)` 先读 cache。
- `lib/session-reader.ts:55` cache miss 时调用 `listAllSessions()`，然后再次查 cache。
- `app/api/agent/[id]/route.ts` 和 `app/api/agent/[id]/events/route.ts` 都会在 session 不活跃时调用 `resolveSessionPath(id)`。

**风险/成本**

未知 sessionId 是廉价输入，但 cache miss 可能触发遍历所有历史 session。个人项目历史 session 多后，随机 id 请求会造成明显 IO 放大。当前没有速率限制，也没有 “这个 id 最近确认不存在” 的负缓存。

**建议**

增加短 TTL 负缓存：

- `globalThis.__piSessionMissCache: Map<string, expiresAt>`。
- `resolveSessionPath()` 如果 miss cache 未过期，直接返回 null。
- `listAllSessions()` 成功后清理已过期 miss。
- 新建/fork 成功时显式 `cacheSessionPath()`，不受负缓存影响。

**验证**

- 新增 `session-reader.test.ts`：同一未知 id 连续 resolve 两次只触发一次 `listAllSessions()`。
- 验证新 session 创建后 `cacheSessionPath()` 能覆盖之前 miss。

**优先级**

短期可做。不是当前明显 bug，但成本低，能避免历史数据增长后的退化。

---

### 5. `app/api/files/[...path]/route.ts` 安全基线好，但端点职责偏集中

**证据**

- `app/api/files/[...path]/route.ts:16` `resolveAuthorizedPath()` 使用 `realpath` 后复验 allowed roots，已覆盖 symlink 绕过。
- `app/api/files/[...path]/route.ts:206` 一个 GET 同时处理 `list`、`read`、`watch`。
- `app/api/files/[...path]/route.ts:276` watch 分支直接创建 `fs.watch` SSE。
- `app/api/files/[...path]/route.ts:329` list 分支 `Promise.all` stat 当前目录所有条目。
- `app/api/files/[...path]/route.ts:347` PUT 分支处理写入。

**风险/成本**

该路由现在同时承载路径解析、安全授权、媒体 range、文本限制、目录列表、SSE watch、写入策略。安全处理做得不错，但未来增加更多文件类型或写入策略时，容易在一个端点里形成交叉回归。`Promise.all` stat 大目录也可能产生瞬时 IO 峰值。

**建议**

拆出纯函数，不急着拆 route 文件：

- `resolveAuthorizedPath()`、`streamFile()`、`listDirectoryEntries()`、`createWatchStream()`、`writeTextFile()` 分别独立测试。
- 对 list 增加分页或上限，例如默认最多 1000 项，并在响应里标记 `truncated`。

**验证**

- 补 `app/api/files/route.test.ts` 或纯函数测试：symlink、range、超大文本、ignored names、大目录截断。

**优先级**

短期演进。当前代码能工作，优化重点是降低未来安全改动风险。

---

### 6. Electron 打包依赖手写白名单，维护成本高

**证据**

- `electron-builder.yml:16` 起配置 `extraResources`。
- `electron-builder.yml:24` 单独复制 `.next/standalone/node_modules`，这是必要的 Next standalone 打包修复。
- `electron-builder.yml:34` 起手动列举 `electron-updater` 及多个传递依赖：`builder-util-runtime`、`fs-extra`、`jsonfile`、`js-yaml`、`lazy-val`、`semver`、`debug`、`sax`、`argparse`、`ms` 等。
- `package.json:37` 仅把 `electron-updater` 放在 dependencies，其余运行时依赖大多依靠手动 extraResources。

**风险/成本**

`electron-updater` 升级时新增传递依赖，开发环境可能正常，生产包运行到自动更新路径才 `Cannot find module`。这是典型“只在打包产物暴露”的问题。

**建议**

两个可选方向：

- 简单方案：写一个 `scripts/check-electron-runtime-deps.mjs`，用 `require.resolve()` 在打包资源目录验证 `electron-updater` 能加载。
- 更稳方案：打包前根据 `npm ls --json electron-updater` 自动生成 extraResources 依赖列表，或将 updater 相关依赖纳入 electron asar 的正常 `files` 追踪。

**验证**

- `npm run pack` 后运行校验脚本，在 `release/win-unpacked/resources` 下尝试加载 updater。
- CI 增加 Windows package smoke test。

**优先级**

近期值得做，尤其是项目继续发布安装包时。

---

### 7. Electron 主进程安全已明显改善，但 CSP 策略有漂移风险

**证据**

- `electron/main.ts:264` 创建 `BrowserWindow`。
- `electron/main.ts:287` 起设置 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。
- `electron/main.ts:302` 起通过 `onHeadersReceived` 注入 CSP。
- 注释中说明该策略 “mirrors the CSP_HEADER constant in middleware.ts”，但当前策略在 `electron/main.ts` 内硬编码。

**风险/成本**

当前安全基线是好的：sandbox、contextIsolation、导航保护、CSP 都在。但 Electron CSP 和 Web/middleware CSP 若长期分开维护，会出现策略漂移。比如 Electron 需要 active port 动态 connect-src，而 Web 端可能需要不同 dev origin，两者不应完全复制，但共享基础策略更可靠。

**建议**

- 新增 `lib/csp.ts` 或 `electron/csp.ts`，导出基础 directives。
- Electron 只负责注入 active port。
- middleware 只负责 Web 场景差异。

**验证**

- 单测基础 CSP 字符串包含 `default-src 'self'`、`img-src data: blob:`、禁止未预期外域。
- Electron 手测本地服务加载和 SSE 连接。

**优先级**

短期演进。当前不是漏洞，但能降低安全策略维护成本。

---

### 8. `quitAndInstall` IPC 缺少“更新已下载”状态门禁

**证据**

- Electron subagent 指出：`electron/preload.ts` 暴露 `quitAndInstall()`。
- `electron/main.ts` 的 `ipcMain.handle("quit-and-install", ...)` 收到调用后动态导入 `electron-updater` 并执行 `autoUpdater.quitAndInstall()`。
- 当前代码依赖 CSP、sandbox、导航拦截降低渲染层被滥用概率，但主进程 handler 本身没有校验 `update-downloaded` 是否已经发生。

**风险/成本**

主进程 IPC 是更靠内层的安全边界，不能只依赖渲染层 UI 是否显示按钮。若未来渲染层出现 XSS、第三方 markdown 渲染漏洞或本地注入，攻击者可直接触发退出安装路径。由于 `autoDownload=false`，未下载时大概率只是失败或 no-op，但主进程仍应保持明确状态机。

**建议**

- 在主进程维护 `updateDownloaded = false` 与 `downloadedVersion`。
- 仅在 `autoUpdater.on("update-downloaded")` 后允许 `quit-and-install`。
- 未下载时返回明确错误或 no-op，并写日志。
- preload 暴露的 API 命名可更具体，例如 `installDownloadedUpdate()`。

**验证**

- Electron main 单测或 mock：未触发 `update-downloaded` 时调用 IPC，断言不会调用 `autoUpdater.quitAndInstall()`。
- 触发 `update-downloaded` 后调用，断言允许。
- 打包后手测更新弹窗流程。

**优先级**

近期值得做。改动小，符合 defense-in-depth。

---

### 9. Packaged readiness 不应被 stdout `Ready` 单独放行

**证据**

- Electron subagent 指出：`electron/server-wait.ts` 使用 stdout/stderr `Ready` 与 `/api/health` 双探测。
- `electron/main.ts` 等待 readiness 后立即 `loadURL`。
- 当前架构文档也强调桌面端启动需要防冷启动 race。

**风险/成本**

stdout 包含 `Ready` 只是日志信号，不是服务可响应 HTTP 的强契约。依赖或 Next 本身如果提前输出包含该字符串的日志，窗口可能在 `/api/health` 尚未可用时加载页面，重新引入冷启动竞态。

**建议**

- 生产 packaged 模式以 `/api/health` 为唯一成功条件。
- dev 模式可保留 stdout 作为辅助诊断；如果 stdout 触发，也应再确认一次 health。
- stdout 匹配应尽量匹配 Next 明确 ready 格式，而不是 `text.includes("Ready")`。

**验证**

- `server-wait.test.ts` 增加用例：stdout 提前输出 `Ready` 但 health 失败时，不 resolve。
- packaged smoke test：启动后 `/api/health` 返回 2xx 再加载主 URL。

**优先级**

近期值得做。它直接保护 Electron 启动稳定性。

---

### 10. SSE 客户端连接管理已有重连，但状态出口仍是全局事件

**证据**

- `hooks/agent-session/agent-events-manager.ts:31` 定义 `AgentEventsManager`。
- `hooks/agent-session/agent-events-manager.ts:80` `connect(sid)` 创建 `EventSource`。
- `hooks/agent-session/agent-events-manager.ts:110` 起最多重连 5 次，指数退避。
- `hooks/agent-session/agent-events-manager.ts:48` 通过 `window.dispatchEvent(new CustomEvent("pi-connection-status"))` 广播状态。
- 服务端 `app/api/agent/[id]/events/route.ts` 已有 `cancel()`、heartbeat cleanup、`session.keepAlive()` 成功 enqueue 后才调用。

**风险/成本**

SSE 生命周期已经不是高风险点。剩下的问题主要是状态出口：连接状态和 stats/context usage 一样走 window event，测试和复用不够显式。

**建议**

把 `AgentEventsManager` 状态改成订阅式 store：

- `subscribe(listener)` 返回 unsubscribe。
- `getSnapshot()` 返回 `ConnectionStatus`。
- React hook 内用 `useSyncExternalStore` 读取。

**验证**

- 扩展 `agent-events-manager.test.ts`，验证 subscribe/unsubscribe 与重连状态变化。

**优先级**

长期演进。先处理 stats/context usage 的 CustomEvent 更划算。

---

### 11. SDK 兼容 workaround 应有退出条件

**证据**

- `lib/rpc-manager.ts:14` 定义 `DEEPSEEK_THINKING_FORMAT`。
- `lib/rpc-manager.ts:258` `set_thinking_level` 分支调用 `applyDeepSeekXhighWorkaround(level)`。
- `lib/rpc-manager.ts:355` 注释写有 `TODO: link`。
- `lib/rpc-manager.ts:362` 直接修改 `inner.agent.state.thinkingLevel = "xhigh"`。

**风险/成本**

这是有意隔离的上游兼容 hack，写法比散落硬编码好。但它仍然触碰 SDK 内部 state，未来 pi SDK 修复后可能变成反向 bug。当前 TODO 没有 issue 链接或版本门槛，维护者不知道何时删除。

**建议**

- 补一个明确上游 issue 或本仓 tracking issue。
- 增加注释：在哪个 pi-coding-agent 版本后应移除。
- 可加测试固定当前行为，避免升级 SDK 时无意改变。

**验证**

- `lib/rpc-manager.test.ts` 增加 deepseek xhigh case 或保留现有相关测试。

**优先级**

近期小修。不是架构大项，但能避免技术债永久化。

---

### 12. 文档体系存在“权威文档新、旧报告旧”的并行事实

**证据**

- `docs/ARCHITECTURE.md` 顶部已更新到 v0.7.16 / 2026-06-24。
- `docs/ARCHITECTURE-REVIEW.md` 顶部基线仍是 v0.7.13 / 2026-06-22。
- 旧报告中提到的若干严重项在当前代码里已修复，例如：
  - Electron `sandbox: true` 已存在于 `electron/main.ts:287`。
  - Electron CSP 注入已存在于 `electron/main.ts:302`。
  - SSE 服务端 cleanup/cancel 已存在于 `app/api/agent/[id]/events/route.ts`。
  - `POST /api/agent/[id]` 已调用 `validateAgentCommand()`，见 `app/api/agent/[id]/route.ts`。
  - `docs/ARCHITECTURE.md` 已记录五个 `globalThis`。

**风险/成本**

旧报告很详细，但如果不标注状态，会让后续维护者重复修已修问题，或者误判当前安全状态。它适合作为历史审查记录，不适合作为当前 todo 清单。

**建议**

- 在旧报告顶部加 “历史报告，部分发现已修复，请以本报告和 `ARCHITECTURE.md` 当前版本为准”。
- 或迁移到 `docs/archive/ARCHITECTURE-REVIEW-2026-06-22.md`。
- 新建一个轻量 `docs/ARCHITECTURE-REVIEW-STATUS.md` 跟踪每项状态也可以，但当前项目规模下可能过重。

**验证**

- grep 文档版本与 package 版本。
- 人工检查 README/AGENTS/ARCHITECTURE 是否仍引用旧报告为当前状态。

**优先级**

近期值得做。文档已经被当作权威工程资产，状态不清会直接影响开发决策。

---

## 不建议立刻做的事

### 不建议引入全局状态库

项目设计目标明确是零状态库。当前问题可以通过拆 hook、显式 props/context、少量 external store 解决，不需要 Redux/Zustand。

### 不建议重写 AgentSession 生命周期

`globalThis.__piSessions`、`__piStartLocks`、idle timer、fork 预注册这些关键约束已经文档化且有测试。近期应做的是补契约测试与边界清理，而不是换架构。

### 不建议把 `/api/files` 安全模型推倒重写

当前已经有 allowed roots、Windows/POSIX 路径处理、realpath 复验、写入敏感路径限制。优化方向是拆测试与拆纯函数，不是重做策略。

---

## 建议新增测试清单

| 测试 | 覆盖风险 |
|---|---|
| `session-reader` 未知 id 负缓存 | 防止 cache miss 全量扫描放大 |
| `AppShell` fork 后重试选择新 session | 去掉固定 50ms 假设 |
| `StatsBar` props 渲染 | 替代 window CustomEvent 后的 UI 契约 |
| `AgentEventsManager` subscribe/getSnapshot | 替代全局连接状态事件 |
| Electron packaged updater dependency smoke test | 防止生产包缺 `electron-updater` 传递依赖 |
| `quit-and-install` IPC 状态门禁 | 防止未下载更新时调用安装路径 |
| `server-wait` stdout/health 契约 | 防止 stdout `Ready` 误判就绪 |
| `/api/files` list 大目录截断 | 防止一次请求 stat 过多文件 |
| DeepSeek xhigh workaround | 固定兼容 hack，便于未来删除 |

---

## 本轮 subagent 调度记录

本轮共尝试 4 次 subagent 调度：

1. 服务端 Agent 会话与 API 架构审查：失败，原因 `Your workspace is out of credits`。
2. 前端组件、hooks 和状态流架构审查：失败，原因 `Your workspace is out of credits`。
3. Electron/打包/工程化架构审查：成功，返回 5 项发现，包括 `quitAndInstall` 状态门禁、packaged 依赖复制、readiness 判定、Windows 签名发布链路、CSP 收敛。
4. 前端组件/hooks/状态流架构审查：成功，返回 5 项发现，包括 CustomEvent 状态桥、`useAgentSession` 过宽、消息渲染全量重算、数据归一化分散、侧边栏/模型配置命令式状态更新。

本报告已吸收第 3、4 个 subagent 的发现，并结合主 agent 本地源码核查做了去重与优先级排序。

---

## 交付建议

建议把本报告作为当前架构优化入口。实际执行时可以先拆成 3 个小 PR：

1. **文档 PR**：标注旧报告状态，补 tracking issue/TODO 链接。
2. **前端边界 PR**：`StatsBar` props 化，移除 stats/context 的 window CustomEvent。
3. **工程化 PR**：Electron updater runtime dependency 校验脚本 + package smoke test。

这三项互相独立，回归面小，能快速降低后续维护成本。
