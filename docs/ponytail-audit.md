# 过度设计审计（ponytail-audit）

> 日期：2026-09-04 · 范围：全仓库（app/api、lib、components、hooks、electron）· 只列问题，不改代码
> 审计维度：过度设计与复杂度。正确性 / 安全 / 性能不在本报告范围内。
> 方法：全量 import 图扫描（280 文件 / 40.5k 行）、导出符号引用计数、模式匹配（单实现接口、纯委托包装、手写轮子、死 barrel、死 flag）。

## 总体结论

**这个仓库已经很瘦**：运行时依赖只有 `electron-updater` 一个；零未引用文件（仅 1 个死 barrel）；全仓库只有 1 处 TODO 标记；38 条 API 路由与 ARCHITECTURE.md 文档一致；没有单实现接口、没有工厂模式滥用、没有 speculative 抽象层。真正的可削减项集中在 **1 个死文件 + 1 组微型模块 + 若干导出噪音**，总量不大。

## 发现（按可削减量排序）

### `delete:` lib/ltm/index.ts — 死 barrel，48 行

纯 re-export 文件，全仓库（含动态 import）**零引用**——所有消费方都直接从 `./config.ts`、`./http.ts`、`./service.ts` 等具体文件导入。删除即可。

- 证据：import 图扫描 0 importer；动态 import 列表中不存在。
- 替代：删除文件。若未来需要统一入口再建（YAGNI）。
- [lib/ltm/index.ts]

### `yagni:` AgentMemoryRestBackend — 第二个 LTM 后端，仅手改配置可达，约 60 行 + 配置管线

`MemoryBackend` 接口有 3 个实现，其中 `agentmemory`（REST）后端只能通过手改 `desktop-settings.json` 的 `ltm.backend` 字段启用——UI 只从 `/api/desktop-settings` 读取 `defaultAgentMode` / `defaultToolPreset`（hooks/useAgentSession.ts:555,608），没有任何界面能切后端。为一个桌面应用维护两个存储后端，属于投机性扩展。

- 证据：`agentmemory` 仅出现于 lib/desktop-settings(.test).ts、lib/ltm/{config,service,agentmemory-backend,index}.ts；components/ 零引用。
- 替代：确认无实际用户后删 `agentmemory-backend.ts` + config/service/设置文件里的 `agentmemory` 分支（约 -100 行，含测试）。若保留，则在文档标注"仅手改配置可用"。
- [lib/ltm/agentmemory-backend.ts, lib/ltm/config.ts, lib/desktop-settings.ts]

### `shrink:` hooks/agent-session 微型模块碎片化 — 7 个 <35 行的模块，各配 1 个测试文件

`agent-phase.ts`(18L)、`prompt-dispatch-gate.ts`(12L)、`session-command-target.ts`(18L)、`session-loader-api.ts`(28L)、`session-stats.ts`(31L)、`stream-state.ts`(32L)、`user-message-reconciliation.ts`(29L)，合计 168 行源码 + 7 个测试文件。拆分本意（纯逻辑可脱离 React 单测）成立，但 12 行一个文件 + 1:1 测试的粒度是导航成本大于抽象收益。

- 替代：合并为 1~2 个 `session-helpers.ts`，测试合并为对应 describe 块（纯逻辑单测性质不变）。省 ~10 个文件、~60-80 行 import/头注释，主要收益是降低导航与心智负担。
- 风险：AGENTS.md / ARCHITECTURE.md 记载"hooks/agent-session 15 模块"，合并需同步文档（neat-freak 收尾）。
- [hooks/agent-session/]

### `shrink:` isRecord / isObject 重复谓词

`isRecord`（app/api/models-config/test/route.ts）与 `isObject`（lib/normalize.ts）是同一个 `typeof === "object" && !Array.isArray` 谓词的两份拷贝。保留 lib/normalize.ts 一份，另一处改为导入。

- [app/api/models-config/test/route.ts, lib/normalize.ts]

### `yagni:` 导出噪音 — export 了只在文件内部使用的符号（改导出为私有，不删代码）

- `getSettingsPath` / `readSettingsFile` / `writeSettingsFile` [lib/extensions-config.ts]
- `VirtualLineWindow` / `VirtualLineWindowInput`（仅文件内使用）[components/file-viewer-virtualization.ts]
- `StatuslineResponse` [app/api/statusline/route.ts]
- `FileIcons.tsx` 中 19 个逐类型 icon 组件（`TypeScriptIcon` 等，仅文件内 map 引用）[components/FileIcons.tsx]
- `DESKTOP_SETTINGS_FILENAME` / `desktopSettingsPath` [lib/desktop-settings.ts]

去掉 `export` 关键字即可，逻辑不动。属卫生项，不计行数收益。

### `delete:` 单个无意义委托 — `getQuitting -> isQuitting`

electron/main.ts 里一层只做转发的 getter。内联掉。

- [electron/main.ts]

## 不算过度设计（防止未来误判）

- **fs-extra devDep 不能删**：它出现在 `lib/electron-updater-runtime-deps.mjs` 的打包清单里，是 electron-updater 的运行时依赖，必须安装才能被拷进 extraResources（对应 ARCHITECTURE.md 打包陷阱）。误删会导致打包后 updater 挂。
- **minimatch devDep**：仅 `lib/electron-builder-config.test.mjs` 使用，用于校验 electron-builder ignore glob。可考虑换手写断言，但收益 ~1 个 devDep，风险大于收益，建议保留。
- **依赖面整体**：运行时依赖仅 `electron-updater`，无 HTTP client、无 state 库、无图标库（`@lobehub/icons` 仅 devDep 用于前端构建）。无 `native:` 级替换机会。
- **1:1 测试密度**（git-worktree 1322L 源 / 1200L 测试等）是本项目"验证优先"纪律的体现，测试不计入过度设计。
- **单行命名谓词**（`isAgentMode`、`isNearDuplicate`、`clamp` ×4 等）：一行函数 + 可读命名，是清晰度而非复杂度，不合并。
- **electron/ 17 个小模块**：每个对应一个独立故障模式（端口、崩溃恢复、标题栏、更新门控），1:1 测试覆盖，是打包陷阱的防线，保留。
- **38 条 API 路由**：与 ARCHITECTURE.md 数量一致，最小路由 4~7 行，无死路由迹象。

## 第二轮深挖（4 条并行只读子代理审查，父会话已复验关键论断）

方法：fresh-context reviewer ×4（hooks / components / lib+API / electron+LTM+打包），共 36 条新发现；以下高置信条目的死代码论断已由父会话用 grep/import 图逐一复验（`<ToolPanel` 渲染点 0、`setExportModalOpen(true)` 仅 AppShell、`<McpConfigModal` 渲染点 0、`createAgentModeCustomEntry`/`safeObserve` 零调用、ChatWindow 实际传参与解构清单）。原始报告：audit/deep/*.md。

### 已复验·高置信（可直接执行）

| # | tag | 发现 | 证据 | 预估 |
| --- | --- | --- | --- | --- |
| 1 | delete | ToolPanel 组件本体是死代码，PRESET_*/getPresetFromTools 常量与纯函数移到 lib/tool-presets | 全仓无 `<ToolPanel` 渲染点；hooks 仅动态 import 取常量；同时解除 hooks→components 反向分层 | -75L |
| 2 | delete | useAgentSession 返回对象 16 个无消费字段（setMessages/dispatch/data/setData/…/currentModel） | 唯一调用方 ChatWindow.tsx:54-74 解构清单不含任何一个 | -25L |
| 3 | delete | ChatWindow 中 ExtensionsConfigModal/SessionExportModal 死挂载（isOpen 恒 false），与 AppShell 双份真相 | setter 置 true 路径全仓仅 AppShell 一处 | -28L |
| 4 | delete | McpConfigModal 独立包装组件无渲染点，只留 McpConfigContent | 全仓无 `<McpConfigModal` JSX | -30L |
| 5 | delete | agent-mode-persistence.ts 重复定义 AgentMode/isValidAgentMode + 死工厂 createAgentModeCustomEntry | approval-policy.ts 已有同款；工厂仅测试引用，rpc-manager.ts:142 内联绕过 | -35L |
| 6 | delete | MemoryService.safeObserve 别名零调用方 | 全仓仅定义处 | -7L |
| 7 | delete | use-agent-events 的 eventSourceRef 伪 ref + agentRunningRef；该 hook 余体（纯透传）可并入 useAgentSession | getter-only + no-op setter | -20L(-35L) |
| 8 | yagni | UseAgentSessionOptions 的 chatInputRef/setNewSessionModel/setToolPreset 从未被传，*External 分支属虚设且藏着 stale-state 隐患 | ChatWindow.tsx:75-77 传参清单无这三项 | -15L |
| 9 | shrink | sessionScopedResetPatch 5 个无读取方字段（caller 手写 setState，从不读 reset.clearXxx） | 全仓单调用点 useAgentSession.ts:528 | -12L |
| 10 | shrink | AttachedImage/ChatInputHandle 类型在 hooks 侧双份拷贝 | components/chat-input/types.ts 已有同形状定义 | -8L |
| 11 | delete | electron/startup-failure.ts（13L 模块+20L 测试，单调用方纯函数）内联进 main.ts catch | shouldShowStartupPage 只是一个布尔改名 | -30L |
| 12 | yagni | main.ts 的 findFreePort（纯转调 choosePort）与 nextServerReadyOptions（单行对象）内联 | 无附加逻辑 | -10L |
| 13 | yagni | extension-render-key.ts 整文件单调用方（ExtensionsConfigModal）内联 | 反查其余小文件均 ≥2 调用方，唯此单调用 | -15L |
| 14 | shrink | tray.ts 两份完全相同的 base64 兜底图标收敛为常量 | try/catch 分支各写一遍同一 Buffer.from | -5L |
| 15 | delete | electron-main-logging.test.mjs 整文件——纯源码 regex 形状守卫（/function logInfo/ 等），无行为区分力 | 断言的是文本形状非行为 | -43L |
| 16 | shrink | electron-icon-assets.test.mjs 删前两测（源码 regex），保留真实资产校验（ico 体积/icns magic） | 对回归无区分力 | -9L |
| 17 | shrink | electron-builder-config.test.mjs 首测与次测同义重复，删其一 | 同一列表同一 yml 两种写法断言两遍 | -8L |
| 18 | shrink | stream-state 的 end/reset 两 action 返回值相同，合并；entryIds 以 `undefined as unknown as string` 塞 string[] 的类型谎言改正 | 两 case 均返回 initialStreamingState；useAgentSession.ts:338,359 | -4L |

### 中置信（结构性改动，需回归测试与视觉校对）

| # | tag | 发现 | 预估 | 风险 |
| --- | --- | --- | --- | --- |
| 19 | stdlib | 41 处 `NextResponse.json({error},…)` 样板 → api-error.ts 增设 jsonError(req,status,msg)（28/38 路由已 import api-error，只缺这个助手） | -40L | 2 处现状不带 x-request-id 头，统一后新增（微行为变化） |
| 20 | shrink | components 内 13 处 fetch→`if(!res.ok) throw`→`err.message` 兜底样板 → 抽 apiJson(url,init) | -50L | fallback i18n key 各异，需参数化 |
| 21 | shrink | 10 处 modal 骨架（backdrop+居中+关闭钮）手写拷贝，Tailwind/内联两套写法并存 → 抽 ModalSurface 基础组件 | -80L | 10 文件视觉回归；勿过度抽象内容区 |
| 22 | shrink | “点外关闭+Escape 关闭”监听 5+ 份拷贝 → useDismissOnOutsideClick hook | -55L | 事件名略异（pointerdown/mousedown） |
| 23 | yagni | desktop-settings 的 ltm 分支：validate/merge/默认值三种方式写同一批 6 字段，DesktopLtmSettings 与 LtmConfigPartial 双份类型 | -35L | 错误文案可能被前端依赖 |
| 24 | shrink | observe 双通道（agentEnd/preCompact）25 行逐行镜像 → safeLtmObserve(input,{flag,kind,build})；observe-payload.ts 并入 observe-hooks.ts | -35L | observe-hooks.test.ts 6 用例结构调整 |
| 25 | shrink | skill 的 disable-model-invocation 正则写入逻辑 2 份同构拷贝（/api/extensions toggle 与 PATCH /api/skills），两套 UI 打同一开关 | -20L | 双 UI 路径回归 |
| 26 | shrink | rpc-manager.ts send() 单 switch 18 case ~270L 职责过载，fork/compact 两 case 可拆独立模块 | 结构性 | fork 预注册时序是 AGENTS.md Key Trap 1，必须原样保留 |
| 27 | 双份真相 | agent-commands.ts AGENT_COMMAND_TYPE_LIST 手工复刻 send() switch case 清单 → 单一来源 | -10L | 漏同步只会在运行时暴露 |
| 28 | shrink | AppShell 两个仅转发参数的包装回调 + stats/usage 类型三处逐字重复 → 直传 setter + 共享类型 | -15L | 低 |
| 29 | yagni | useChatScroll.agentRunningRef 镜像第三份 agentRunning 存储 → 直接消费参数 | -6L | StrictMode 语义 |
| 30 | shrink | useAgentSession 的 pending prompt/steer 入队-对账逻辑（~90L）经 4 个回调穿越两文件互改同一组 ref → 整体移入 use-session-commands | -30L | 竞态/StrictMode 双调用，单独 PR |
| 31 | shrink | file-browser.ts 目录列表两阶段截断（name 级 + stat 后“保险”再截一次）→ 一次截断语义 | -8L | 置信度低，防御性语义需确认 |
| 32 | 报告项 | 硬编码英文文案违反 i18n 约定：/skills /tools slash 命令 markdown（use-session-commands.ts:157-181）等 4-5 处 | — | 文案改动，需双语文案 |

### 子代理判定“不算过度设计”（与第一轮结论一致，防止误改）

- 消息流无双份真相：loader messages 与 streamingMessage 是“已落地 vs 流式中”两阶段，配对正确；路径缓存是单套（rpc-manager→session-reader→同一 globalThis）。
- normalizeToolCalls 已收敛到 lib/normalize.ts 一处实现，两条路径均调用它。
- usePanelLayout/useTheme/useAudio/useDragDrop 等单调用方 hook 均有真实 state/effect，不建议内联。
- ChatInput 28 个 props 全部有真实传值与消费（宽 facade 而非过度泛化）；AppShell→ChatWindow 链仅 2 跳无纯搬运。
- SkillsConfig 单文件与 models-config 子目录两种组织并存但各自内聚，不为合并而合并。
- server-process 双实现包装、installer-script/extraResources/titlebar 守卫是真陷阱防线，保留。
- git-worktree.ts export 面大于生产所需但被测试合法使用（fail-closed 是文档要求），不动。

### 净收益估算（两轮合计）

已复验高置信 ≈ **-374L、-0 deps**；中置信结构性 ≈ **-450L**（含第一轮 ltm barrel -48L、agentmemory 后端 -100L、agent-session 微模块合并）。

`net: -820~1000L（约 2~2.5%），-0 deps，-15~20 个文件`

结论不变：**结构健康，无需架构级大动**。第二轮收益主要来自死 UI 代码（ToolPanel/死挂载/死包装）与样板收敛；所有结构性条目（#21/#26/#30）建议各自独立 PR 带回归测试。

## 执行结果（第二轮执行已完成，2026-09-04）

按优先级 1-5 执行：4 批 worker（gpt-5.6-luna:xhigh，单写者顺序）+ jsonError 收尾 sweep + 评审修复。三轴评审（Standards/Spec/测试专审）后：Spec 与测试专审的 BLOCK 项已处置。

**已落地**：

- 批1-4 全部完成：死 barrel、agent-mode 收敛、safeObserve、tray 常量、startup-failure/main.ts 内联、守卫测试修剪、isRecord 合并、导出噪音；hooks 死字段/伪 ref/死 option/reset patch/类型去重/entryIds 类型；ToolPanel→lib/tool-presets、ChatWindow 死挂载、McpConfigModal 死包装；jsonError/apiJson/useDismissOnOutsideClick 样板收敛。
- jsonError 收尾：24 个 route 文件的剩余 ~100 处单字段错误样板全部转换；合法豁免 3 类（branch/clone 带 errorCode 协议、models-config/test 的 ok:false 协议）。
- 评审修复：tool-presets 复用 approval-policy 常量（消 S3 重复）；extension-render-key 恢复为 lib 模块并补行为测试（评审证明 #13 原裁定漏了覆盖价值，已修正）；apiJson 补网络异常分支测试；文档同步（ARCHITECTURE.md 剔除 ToolPanel/startup-failure 引用、修 14.2 孤儿文件语义与 14.3 SSE 调用点、AGENTS.md Key Trap 1 同步）。

**有意不修（含理由）**：

- startup-failure 决策不恢复模块：被删测试是恒真式（shouldQuit: !uiReady 只测了 `!`），基线覆盖本就为零，不因评审压力重建仪式。
- use-agent-events 并入 useAgentSession：deferred（StrictMode/时序敏感，需单独 PR）。
- useDismissOnOutsideClick 无单测：DOM hook，无 jsdom 基建，成本>价值。
- apiJson 的 fallback 仅在非 Error 抛出时生效（网络异常的 TypeError 原样穿透）：与改造前内联代码语义一致，属既有怪癖，测试已钉真实语义。

**净变化**：56+24 文件，约 +280/-1050（净约 -770 行），-8 文件，-0 deps。验证：tsc 双工程通过、全量测试 0 fail、lint 通过。

**已完成追加**：agentmemory 后端已删（344b69b，净 -221L，用户拍板）——生产代码零残留，memory 工具/Sqlite/Noop/observe 通道不动，架构文档同步；恢复命令：`git show fd5bca1 -- lib/ltm/agentmemory-backend.ts`。

**仍未执行（待决策）**：结构性项 rpc-manager fork/compact 拆分(#26)、pending 对账迁移(#30)。

## #21 执行结果（2026-09-04 追加）

ModalSurface 外壳已落地（46ad6b9）：仅 3 个可证明 class 等价的 Tailwind 站点转换（Extensions/SessionExport/BranchClone），aria-label 升级为 heading id + ariaLabelledBy；5 个内联样式站点与 2 个非 modal 外壳合法豁免（等价性不可证 / 行为改变风险）。**净 +34L**——原估 -80L 基于 10 站点全转换，实际收益是结构性收口（单一位置管理 dialog role/aria/遮罩）而非行数；unused onClose 已删。同期发现并修复批 2 引入的形状断言断链（useAgentSession.test.ts 锚点改为语义锚，8ed8832）——该事故印证“worker 自报绿不可信”，全量门禁必须父会话亲自跑。

**累计净变化**：c8d2748（-726L）+ 8ed8832/46ad6b9（+34L）≈ **净 -690 行**。

## 若执行的优先级（历史记录，已按此执行）

1. 删 lib/ltm/index.ts（零风险，立即 -48 行）
2. 第二轮已复验高置信表 #1-#18（死代码类，逐条带测试收缩）
3. 去导出噪音（零风险）
4. 合并 isRecord/isObject（低风险）
5. 样板收敛三件套：jsonError(#19) / apiJson(#20) / useDismissOnOutsideClick(#22)
6. 决策 agentmemory 后端去留（需确认是否有真实用户）
7. 结构性项各自独立 PR：modal 骨架(#21)、rpc-manager fork/compact 拆分(#26)、pending 对账迁移(#30)——均需同步 ARCHITECTURE.md/AGENTS.md（neat-freak 收尾）
