# Pi Agent Desktop 架构状态汇总

> 日期：2026-06-04  
> 范围：替代 2026-05-30 至 2026-06-03 的架构分析、P0/P1 评审、实施计划和设计文档。  
> 目的：保留当前状态和后续待办，移除已经过期的长篇历史文档。

## 当前结论

P0、P1 和已列出的 P2 工程化/性能/可观测性收敛项已经基本落地。旧文档中的不少行号和状态已经过期，因此以后以本文为当前架构清理入口。

后续仍可继续推进的 follow-up 主要集中在把 scope 字段实际推广到渲染进程与 Next API 的日志入口，以及是否引入本地提交前检查。

## 已完成

### 会话文件与 Agent 生命周期

- JSONL 会话写入增加文件级串行锁和原子替换，降低并发 DELETE / 级联改写损坏风险。
- SSE heartbeat 会刷新 AgentSession idle timer，避免长任务在无真实事件期间被 10 分钟 idle 回收误杀。
- fork 在销毁旧 wrapper 前预注册新 session；navigate_tree 改为 await，并在失败时回滚 UI leaf 状态。
- session 切换时的 mount effect 依赖和过期结果防御已重构，减少旧 SSE 连接和旧状态覆盖新 session 的风险。

### UI 状态与渲染

- ChatWindow 消息渲染拆出 MessageList，并通过 memo / 稳定 key / 预计算索引降低长对话重渲染成本。
- URL 与 cwd/session 状态同步已移除 `suppressCwdBumpRef` 类互抑制 hack。
- `currentModel`、`displayModel`、`sessionStats` 等派生值已 memo。
- SSE event JSON parse 失败不再静默吞掉，当前会输出错误日志。

### API、错误与安全边界

- API catch 从直接 `String(error)` 改为统一错误消息、request id 和结构化 console error。
- `normalizeToolCalls` 去掉不必要的强制断言，并补充边界测试。
- `SKILLS_API_URL` 已做 host/protocol allowlist，避免被任意环境变量指向内网或非预期服务。
- Electron startup 页 CSP 已把 script 收紧为 `script-src 'self'`，内联脚本风险已处理。

### Electron 启动与打包

- Electron 子进程环境变量改为白名单透传，只显式传递运行所需环境和 API key。
- 端口选择改为直接 reserve/listen，减少检查端口和真正监听之间的 TOCTOU 窗口。
- Next.js 子进程退出后已有自动重启策略，重启次数在时间窗口内受限。
- `electron-builder.yml` 已复制 `.next/standalone`、`.next/standalone/node_modules`、`.next/static` 和 `public`，不再依赖手写传递依赖列表。

### P2-0 工程化校准

- `package.json` 已增加统一 `test` 脚本，覆盖当前仓库内 first-party Node test 文件。
- GitHub Actions 已复用 `npm test`，避免 CI 和本地测试列表漂移。
- 后续 P2 改动默认用 `npm test`、`npm run lint` 和 `npx tsc --noEmit` 作为基础验证入口。

### P2-1/P2-3 后续路线图收敛

- `components/FileViewer.tsx` 的大文件 source/plain text 路径已改为可见区域渲染，普通小文件、markdown preview、HTML preview 和 diff view 保持原路径。
- `lib/rpc-manager.ts` 不再向 `createAgentSession` 传硬编码默认工具全集；非空工具选择改为创建后调用 `setActiveToolsByName(toolNames)`，关闭全部工具仍传 `tools: []`。
- FileViewer 大文件窗口计算已抽成可重复测试的纯函数，覆盖首屏兜底和滚动偏移场景。
- Electron 主进程日志写入改为结构化 JSON 行，统一包含 `time`、`level`、`source`、`message` 和可选 `detail`，并对 Error detail 做摘要。
- 新增 `build:standalone` 明确表示 Next.js standalone 构建；`build` 保留为兼容别名，发布和打包脚本改为调用 `build:standalone`。

### P2-4 日志 scope 字段落地

- `electron/log-format.ts` 的 `ElectronLogEntryInput` 增加 `scope: string` 必填字段，并引入 `ElectronLogSource = "electron-main" | "electron-renderer" | "next-api"`，便于后续在渲染进程和 Next API 沿用同一格式。
- `electron/log-format.ts` 导出 `deriveScope` 辅助函数，从消息首词派生稳定 scope（默认 `"main"`），`electron/main.ts` 的 `writeLog` 改为通过它注入 scope，所有现有调用点统一走同一路径。
- `electron/log-format.test.ts` 增补 scope 字段相关断言（主进程、渲染进程、Next API 三类 source 均可解析回原 scope），保证后续推广时格式契约不退化。

## 仍需处理

后续剩余 follow-up 集中在是否引入 husky / lint-staged 等本地提交前检查，以及把 scope 字段实际推广到 Electron 渲染进程和新增模块的调用点。

