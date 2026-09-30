# Pi 核心依赖升级与内置 MCP 接入调研

> 检索日期：2026-09-30（Asia/Shanghai）。基线为本项目实际安装的 0.84.3；目标为检索时 npm `latest` 的 0.99.1。仅研究，未修改依赖、锁文件或业务代码，未安装新版、运行新版类型检查或连接真实 MCP 服务。
> 来源：npm 官方 registry、上游 `earendil-works/pi` 的固定 `v0.99.1` 标签源码/文档、npm 发行包声明、本项目接入代码。上游 changelog 日期与 npm 发布时刻分别记录，不混用时区。

## 结论

建议将直接依赖 `@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent` 一起升级到 **0.99.1**，再完成 SDK、会话事件、工具权限与打包适配。四个核心包同版发布，Node 最低要求仍为 `>=22.19.0`。这次跨越多个带破坏性变更的版本，不能只改版本号就视为兼容。[npm coding-agent](https://registry.npmjs.org/@earendil-works/pi-coding-agent)、[npm pi-ai](https://registry.npmjs.org/@earendil-works/pi-ai)

**桌面端 MCP 应复用 Pi 的官方 `createMcpExtension()`，管理界面读写标准 `mcp.json`，连接、协议、OAuth、工具执行交给 Pi。** 这属于加载上游内置实现，不需要另写一套 MCP 插件。但 SDK 不会自动加载 CLI 的内置扩展：升级本身不会让桌面端获得 MCP；必须显式挂载官方工厂。[SDK 示例](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/examples/sdk/14-codemode-mcp.ts)

## 版本与发布时间

| 包 | 当前实际安装 | 最新稳定 | npm 发布时间 UTC | 北京时间 | Node 要求 |
|---|---|---|---|---|---|
| pi-ai | 0.84.3 | 0.99.1 | 2026-09-29 18:20:01.695 | 2026-09-30 02:20:01.695 | >=22.19.0 |
| pi-coding-agent | 0.84.3 | 0.99.1 | 2026-09-29 18:23:26.245 | 2026-09-30 02:23:26.245 | >=22.19.0 |
| pi-agent-core | 0.84.3（传递依赖） | 0.99.1 | 2026-09-29 18:17:42.746 | 2026-09-30 02:17:42.746 | >=22.19.0 |
| pi-tui | 0.84.3（传递依赖） | 0.99.1 | 2026-09-29 18:18:39.945 | 2026-09-30 02:18:39.945 | >=22.19.0 |

时间来自各 registry 文档 `time["0.99.1"]`，版本来自 `dist-tags.latest`，运行要求来自对应版本 `engines`。[pi-ai](https://registry.npmjs.org/@earendil-works/pi-ai)、[pi-coding-agent](https://registry.npmjs.org/@earendil-works/pi-coding-agent)、[pi-agent-core](https://registry.npmjs.org/@earendil-works/pi-agent-core)、[pi-tui](https://registry.npmjs.org/@earendil-works/pi-tui)

项目 `^0.84.3` 按 0.x 的 caret 规则不会自动跨到 0.99.x。目标 coding-agent 的核心传递依赖改为同版 `pi-agent-core/pi-ai/pi-tui`，并新增 `chord/pi-mcp/pi-codemode/quickjs-wasi`，原 `pi-client/pi-protocol` 不再是它的直接运行时依赖。不要顺手将所有传递包加成桌面项目直接依赖；先让 npm 锁定目标依赖图。[目标 manifest](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/package.json)

## 0.84.3 之后值得升级的内容

| 版本与上游日期 | 对桌面接入的价值 |
|---|---|
| 0.84.4，2026-08-28 | 修复流式 thinking signature 反复序列化；增加 UI prompt 事件、队列清理；修复 JSONL 无末尾换行追加、Windows abort、工具结果后压缩等问题。 |
| 0.85.0，2026-09-04 | 可恢复的 in-memory session；修复 fork 丢压缩边界、工具 cwd、手动 compaction abort；增加模型兼容参数。 |
| 0.86.0，2026-09-19 | transcript 中保存系统提示/工具变化，缓存保温、模型级压缩预算；修复 EventStream 缓冲队列的二次方 CPU 消耗。 |
| 0.87.0，2026-09-21 | SessionManager 成为模型上下文权威来源；追加式 context edit，新的可操作生命周期边界。 |
| 0.99.0，2026-09-29 | 内置 MCP、codemode、tool_search，ChatGPT 登录、虚拟模型、统一图像/分类模型能力。 |
| 0.99.1，2026-09-29 | 新增 GPT-6.1 Sol；修复 bundled OpenAI 登录缺少模块。 |

来源：[coding-agent changelog](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/CHANGELOG.md)、[pi-ai changelog](https://github.com/earendil-works/pi/blob/v0.99.1/packages/ai/CHANGELOG.md)。模型名称和能力是 Pi 上游发布记录，不代表已独立验证账户可用性。

此前 [issue-20 白屏报告](issue-20-white-screen-analysis.md) 记录的 0.84.3 流式 reasoning 序列化问题，现在有 0.84.4 修复记录；它增强了升级价值，但不能因此认定旧白屏问题的唯一根因已经解决。[上游修复 PR #8671](https://github.com/earendil-works/pi/pull/8671)

## 必须注意的兼容变更

- **自定义 provider**：0.86 起流入 provider 的上下文改为 `TranscriptContext`；系统提示和工具定义在 system messages 中，通过 `getCurrentSystemPrompt()` / `getCurrentTools()` 读取。`ToolCall.arguments`、结果 details 限制为 JSON 兼容值，数组 readonly；原先 `unknown`/任意对象假设需重新检查。[自定义 provider 文档](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/custom-provider.md)、[pi-ai changelog](https://github.com/earendil-works/pi/blob/v0.99.1/packages/ai/CHANGELOG.md)
- **上下文与历史**：增加 `context_edit` 类型；不能再通过赋值 `session.agent.state.messages` 替换后续模型请求历史。应使用 SessionManager、navigateTree 或追加后 refreshContext；原始历史显示与模型上下文投影要区分。[会话格式](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/session-format.md)、[SDK](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/sdk.md)
- **Agent hook**：`shouldStopAfterTurn` 删除，迁至 `finishTurn`；它会接收到 error/aborted，需要保持旧谓词语义。0.84.4 起 prepareNextTurn 只在确定还有下一 turn 后调用。[agent-core changelog](https://github.com/earendil-works/pi/blob/v0.99.1/packages/agent/CHANGELOG.md)
- **事件**：新增 `agent_before_settle`，turn_end 有新增必填边界字段；`agent_end` 不能代表整个会话已停，最终通知是 `agent_settled`。settled handler 内请求新运行会延迟到全部 handlers 完成后。[扩展事件文档](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/extensions.md)、[AgentSession 源码](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/agent-session.ts)
- **其他外部扩展**：Cloudflare 的 `createGatewayBindingFetch` 改为 `createAiBindingFetch`；图像模型并入 Provider/Models，旧 ImagesModels API 删除。pi-tui 的 terminal color 查询 API 和部分环境变量变化。若桌面端或用户扩展未使用这些接口，则无需为其另写兼容层。[ai changelog](https://github.com/earendil-works/pi/blob/v0.99.1/packages/ai/CHANGELOG.md)、[tui changelog](https://github.com/earendil-works/pi/blob/v0.99.1/packages/tui/CHANGELOG.md)

新版 npm 发行包仍公开 ModelRuntime、ModelRegistry、createAgentSessionServices、SessionManager、SettingsManager、AgentSession、DefaultResourceLoader；不能因架构重构就断言这些公共工厂被删。实际调用参数和行为仍需升级后验证。[入口源码](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/index.ts)

## MCP 配置与能力边界

### 配置位置与最小格式

全局：`~/.pi/agent/mcp.json`（以实际 Pi agentDir 为准）；项目：`<cwd>/.pi/mcp.json`。同名项目项覆盖全局，只有项目被信任后才读取项目配置。基础格式如下：[配置源码](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/extensions/mcp/config.ts)

```json
{
  "mcpServers": {
    "local-tools": {
      "command": "npx",
      "args": ["-y", "example-mcp-server"],
      "env": { "TOKEN": "${TOOLS_TOKEN}" },
      "exposure": "direct",
      "enabled": true
    },
    "remote-tools": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ${REMOTE_TOKEN}" },
      "exposure": "codemode"
    }
  }
}
```

这是格式示例，不是可直接连接的真实服务。

stdio 支持 command/args/env/cwd；相对 cwd 按会话目录解析。HTTP 是 streamable HTTP，**不支持旧 SSE transport**。type 可省略，显式 `streamable-http` 会规范为 http；服务器名仅字母、数字、`_`、`-`。env/headers 支持 `${NAME}`、整值 `!command`；timeout 单位秒，默认 60，进度通知重置计时；无效条目报错并跳过。[配置类型与校验源码](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/mcp-servers.ts)

### 认证与权限

无 Authorization header 的 HTTP 服务可自动发现 OAuth；支持动态客户端注册，或配置 clientId/clientSecret/callbackPort/callbackUrl/scope。凭证保存于 agentDir 的 `mcp-auth.json`，由 Pi 刷新；回调是 loopback HTTP。UI 应展示授权链接、接收用户取消/失败，并调用 Pi 的现有认证流程，不自行存取 OAuth token。[OAuth 源码](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/extensions/mcp/oauth.ts)

项目信任决定是否执行项目 MCP 配置，工具调用仍经过 Pi 的 `tool_call`/`tool_result`；codemode 嵌套调用带 `parentToolCallId`。服务器 annotations 包括 readOnlyHint/destructiveHint 等，供权限判断使用，不能只靠本项目固定内置工具名识别危险调用。[工具转换源码](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/extensions/mcp/tools.ts)、[MCP 权限说明](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/mcp.md#permissions)

### 暴露模式

| exposure | 模型使用方式 |
|---|---|
| codemode（默认） | 通过 codemode 脚本，工具摘要进入其描述；不直接声明为模型工具。 |
| codemode-deferred | 通过脚本发现/调用，描述仅列服务器与工具数。 |
| deferred | tool_search 加载后直接调用；也可从 codemode 使用。 |
| direct | 直接声明，同时可从 codemode 调用。 |
| hidden | 注册但不可调用。 |

`toolExposure` 按具体工具覆盖服务器模式，可用通配符；精确名称优先，模式按对象顺序匹配。`autoEnableCodemode` 默认 true，项目值覆盖全局。不要将“隐藏声明”误当成“禁止调用”，只有 hidden 是不可达。[暴露类型源码](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/mcp-servers.ts)

### 启停、重载与状态

运行连接状态有 connecting/connected/disconnected/needs-auth/failed/closed，禁用单独根据配置体现。连接持有 tools、error、stdio stderr tail；断线后下次调用重连，工具列表变更会同步。启动连接异步进行，首条 prompt 默认最多等 10 秒；会话结束关闭连接。[连接运行时源码](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/extensions/mcp/runtime.ts)

TUI `/mcp` 能实时查看列表、工具、错误、来源，并启用/禁用/切换 exposure，立即应用且保存原配置文件。**非 TUI** 的 `/mcp` 是文本通知；公开命令仅 login/logout/reconnect，没有 enable/disable/exposure 参数。新增或编辑配置后需要 `/reload` 或新会话；不需要退出整个桌面应用。OAuth 独立命令登录的新凭证会在下一 turn 检测。[官方 MCP 文档](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/mcp.md)、[扩展命令源码](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/extensions/mcp/index.ts)

资源能力包含 list/read/templates。Pi 不渲染 MCP Apps；资源列表排除 ui:// 与 MCP App HTML，不能承诺仅升级即可显示服务端自带网页。[资源实现](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/extensions/mcp/resources.ts)

## 桌面端怎样复用，而不是重写

### 官方 SDK 接入

DefaultResourceLoader 的 extensionFactories 挂载 `createCodemodeExtension({ mode: "on" })`、`createToolSearchExtension()`、`createMcpExtension()`，loader.reload 后把同一个 loader 传给服务/会话工厂；`session.bindExtensions()` 触发 session_start 并连接服务器。官方示例用 settings 的 `defaultTools: ["+codemode", "+tool_search"]` 追加工具。[SDK 示例](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/examples/sdk/14-codemode-mcp.ts)

若想像 CLI 一样让用户 `-builtin:mcp` 配置生效，可使用命名 InlineExtension 的 `builtin: true`，而不是把所有官方工厂都当作无法禁用的普通匿名工厂；其取舍需要实现时核实 loader 行为。[SDK builtin 说明](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/sdk.md)

### 管理 API 的真实缺口

`createMcpExtension(options)` 公开 options：loadConfig、createTransport、credentials、logPath、openUrl、updateConfig、startupWaitMs；返回值是 ExtensionFactory，**没有** getServers/subscribe/enable/disable 等可直接给 React 调用的 controller。运行状态和管理 actions 位于扩展内部闭包。[工厂源码](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/extensions/mcp/index.ts)

内部 config 模块有 load/add/update/remove 函数，但顶级入口只导出相关类型，没有导出这些函数；package.exports 没有这些深层路径。不能把 node_modules 存在 dist 文件当成稳定公共 SDK。内部 McpManagerView 是 TUI 组件，`ctx.mode === "tui"` 才进入；桌面 UI 的 custom callback 不是自动等价的 React 管理 API。[入口](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/index.ts)、[exports](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/package.json)、[管理视图](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/extensions/mcp/ui.ts)

本项目现有桥的 `custom()` 返回 `Promise.resolve(undefined)`，`setStatus()` 无实际处理；只有 confirm/select/input/editor 和 notify 经 SSE 转发。因此不能直接通过现有桥展示上游 TUI MCP manager。[UI 桥](../../lib/extension-ui-bridge.ts)

首版可复用的范围：

1. 桌面服务端提供标准 mcp.json 的 CRUD、enabled/exposure 编辑；保护其他键，编辑后等待会话 idle 再调用上游 reload。配置校验和文件写入是 UI 适配层，协议/连接/OAuth/执行继续由官方扩展负责。
2. 通过上游 slash command 复用 login/logout/reconnect，验证现有 notify/input 桥、openUrl（Electron 浏览器打开）和取消行为。
3. 服务器配置列表可直接读取；**实时连接列表与状态**需要最小上游 controller/状态订阅 API 或经过明确版本固定的窄适配接口。`pi mcp list` 会另建连接，不能当作当前会话运行态，也不宜为了 UI 持续运行第二套连接。

上述是建议路线，未实现、未验证热重载或 OAuth 整链路。

## 本项目必须处理的接入点

| 当前机制 | 升级/接入动作 |
|---|---|
| createPiRuntime：ModelRuntime.create → createAgentSessionServices → ModelRegistry | 保留加载扩展 provider 的服务工厂，把官方扩展挂在同一 resourceLoader；避免选择器与会话使用不同扩展世界。 |
| rpc wrapper 暂存 agent_end，agent_settled 后 dispatch 队列 | 验证新的 settled 延迟调度；避免重复结束、提前 idle 或丢 follow-up。 |
| effectiveToolsForMode 固定内置名称，启动和切模式再次 setActiveToolsByName | 保留模式授权的 MCP/codemode/tool_search；否则上游刚激活的工具又被本项目覆盖。 |
| needsAskConfirm 只覆盖 bash/write/edit/memory_save/memory_forget | 对 MCP 及 codemode 嵌套调用建立权限映射，沿用 Pi 工具管线，不通过 codemode 绕过确认。 |
| session-reader 与前端历史/SSE 归一化 | 检查新增 context_edit、嵌套工具结果、parentToolCallId、队列 disposition；保留原历史与上下文投影区别。 |
| ensure-standalone-pi-runtime 递归复制根包的依赖/可选/peer；Next 外部包与 tracing | 验证新增 pi-mcp/pi-codemode/chord/quickjs-wasi、WASM/worker/动态资源完整，不因开发环境成功就认为打包成功。 |

这些是本项目静态接入审查，不代表已经在 0.99.1 上证实故障。依据：[runtime](../../lib/pi-runtime.ts)、[RPC 管理](../../lib/rpc-manager.ts)、[模式及权限](../../lib/approval-policy.ts)、[打包补齐脚本](../../scripts/ensure-standalone-pi-runtime.mjs)、[Next 配置](../../next.config.ts)。

## 实施与验证顺序

1. 同步更新两项直接依赖与 lock，确认核心传递包版本和新增依赖图；先跑 tsc 与相关 SDK/runtime/事件/历史测试，再修真实不兼容。
2. 挂载官方扩展，先验证一个 stdio 和一个 streamable HTTP 服务的工具调用；验证 global/project 覆盖、不可信项目不加载、禁用/重载关闭旧连接。
3. 接 UI 配置与认证入口，验证 login/logout/reconnect、错误、取消、工具暴露与模式切换、嵌套权限确认和 follow-up 调度。
4. 检查打包脚本与动态资源，依项目规则不在 dev 环境运行 next build；正式打包验证另选适合环境。

检索限制：没有运行新版类型检查/测试、没有真实服务器/OAuth 和 Windows 进程树关闭验证、没有正式打包验证；本报告只证明版本/接口/源码事实与适配方向。第一轮升级应优先验证现有功能，MCP UI 接入按上面边界实现，不扩展成 MCP Apps 或独立协议客户端。

## 后续实施记录（2026-09-30）

在 `dev/pi-core-0.99.1` 升级 `pi-ai`、`pi-coding-agent` 并直接依赖公开的 `pi-mcp` 客户端用于用户主动发起的连接测试。会话挂载官方 MCP、Codemode 与工具搜索扩展；桌面层只负责配置兼容、UI 和权限，不实现 MCP 协议或独立会话连接。

“工作台菜单 → 扩展与 MCP → Codemode”提供默认关闭的持久化开关、中英文说明、使用示例和权限说明。运行中的任务结束后应用变更；Plan 或禁用工具时禁止执行 Codemode。MCP 配置支持 stdio 和 Streamable HTTP、HTTP headers、原生 exposure；保留已有 OAuth 等高级配置。旧 SSE 配置提示迁移，不自动当作 HTTP 使用。项目配置仍需信任，配置修改在下一条消息前重载。

通过 `npm test`（660 通过、2 跳过）、改动文件 ESLint、排除 `.next` 生成文件的源码类型检查及 `git diff --check`。使用真实隔离的 stdio/本地 Streamable HTTP 服务验证协议握手和工具发现；stdio 会话验证原生 Codemode 嵌套调用、Ask 拒绝、Plan/关闭开关拦截。回归覆盖重载先于 prompt、扩展 shutdown 先于 dispose、context_edit 的历史消息来源对应。浏览器在隔离 agentDir 验证开关保存、重开读回与说明布局。

完整 lint 仍受已有 `docs/assets/liquid-orb.js:53` 的 `no-assign-module-variable` 错误阻塞；dev 生成的完整类型检查仍受已有 usage 路由 `createUsageGetHandler` 额外导出阻塞。当前机器的 SWC 原生二进制不可用，UI 验证使用 webpack/WASM fallback。遵守项目约定未运行 `next build`；正式打包、真实外部服务 OAuth/登录 UI、完整 Windows 子进程树回收尚未验证。MCP UI 显示配置状态，当前会话的连接及认证仍由原生 `/mcp` 命令管理。

后续按用户要求清除 CI 阻塞：shader 局部变量改名为 `shaderModule`，usage 路由的测试工厂移至 `lib/upstream-usage/route-handler.ts`，保留合法路由导出。完整 lint 和包含 dev 生成文件的 `npx tsc --noEmit` 已通过，usage 路由回归测试通过。另修复混合 `enabled`/旧 `disabled` 字段时 UI 与运行层的启用状态不一致，并更新 HTTP 表单双语文案；新增启用状态组合回归测试。生产构建继续由 PR CI 验证。
