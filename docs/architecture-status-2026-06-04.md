# Pi Agent Desktop 架构状态汇总

> 日期：2026-06-04  
> 范围：替代 2026-05-30 至 2026-06-03 的架构分析、P0/P1 评审、实施计划和设计文档。  
> 目的：保留当前状态和后续待办，移除已经过期的长篇历史文档。

## 当前结论

P0 和 P1 中影响稳定性、启动、打包、安全和状态同步的主要问题已经基本落地。旧文档中的不少行号和状态已经过期，因此以后以本文为当前架构清理入口。

仍未完成的重点集中在 P2 和少量 follow-up：大文件渲染体验、工具名白名单硬编码、测试脚本覆盖、CI/git hooks、构建脚本命名，以及更完整的可观测性和性能回归验证。

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

## 仍需处理

后续工作按“先稳住验证入口，再处理用户可感知性能，最后清理架构债和补强可观测性”的顺序推进。以下四项是当前建议的 P2 路线图。

### P2-0 工程化校准

目标是先让后续改动有统一、可靠的验证入口。当前仓库已经存在 `.github/workflows/ci.yml`，但 `package.json` 仍没有统一 `test` 脚本，CI 里的测试列表也和仓库实际测试文件不完全一致。

建议工作：

- 在 `package.json` 增加统一 `test` 脚本，覆盖项目内 Node test 文件，包括 `app/`、`lib/`、`hooks/` 和 `electron/` 下的测试。
- 让 GitHub Actions 调用同一套测试入口，或至少同步覆盖完整测试列表，避免本地和 CI 漂移。
- 更新本文档中的工程化状态，避免继续保留已经过期的 CI 缺失结论。
- 暂缓引入 husky / lint-staged，除非明确需要本地提交前强制检查；这类工具会改变提交体验，应单独评估。

成功标准：本地 `npm test`、`npm run lint`、`npx tsc --noEmit` 和 CI 中的测试范围一致，后续 P2 改动可以直接复用这些命令验证。

### P2-1 FileViewer 大文件虚拟滚动

目标是解决大文件查看时的真实渲染压力。当前 `components/FileViewer.tsx` 已有大文件纯文本降级路径，会关闭语法高亮，但 `PlainTextViewer` 仍会对全部行执行 `lines.map(...)`，因此超长文件仍可能一次性生成大量 DOM 节点。

建议工作：

- 只在 source/plain text 路径引入可见区域渲染，保留 markdown/html/diff 的现有行为。
- 对大文件按滚动位置计算可见行范围，并用上下占位高度维持滚动条比例。
- 保持普通小文件路径不变，避免为常见场景引入复杂度。
- 验证 wrap on/off、行号、横向滚动和文件变更刷新路径不会回退。

成功标准：大文件不再一次性渲染所有文本行，滚动体验稳定；小文件、markdown preview、HTML preview 和 diff view 行为保持不变。

### P2-2 工具名来源去硬编码

目标是减少桌面端和 pi agent 上游工具注册之间的漂移风险。当前 `lib/rpc-manager.ts` 在创建 session 时仍保留内置工具名列表：`["read", "bash", "edit", "write", "grep", "find", "ls"]`。

建议工作：

- 优先确认 `@earendil-works/pi-coding-agent` 是否暴露可枚举的工具注册结果或默认工具集合。
- 如果可获取，则从上游工具注册结果派生默认工具名，并在 session 创建路径缓存或复用该结果。
- 如果暂时不可获取，则至少把硬编码列表收敛到单点导出，并用测试明确当前行为，避免继续散落在启动逻辑中。
- 保持 `toolNames = []` 表示关闭全部工具、指定非空工具列表表示按用户选择启用的语义不变。

成功标准：默认工具集合的来源更接近 pi agent 实际注册状态；上游工具名变化时，桌面端要么自动跟随，要么能通过单点测试暴露差异。

### P2-3 性能与可观测性补强

目标是把 P0/P1 已完成的稳定性改动转化为可回归验证的质量保障，并为用户问题诊断提供统一线索。当前已有 API 层 request id 和结构化错误日志，但 Electron 主进程、Next API route、SSE 事件和 autoUpdater 仍缺少统一日志约定。

建议工作：

- 给长对话渲染和 FileViewer 大文件路径补轻量、可重复的性能回归验证，例如固定消息数量或固定文本行数下的渲染耗时基准。
- 补充 compact、FileViewer 大文件路径、Electron restart failure/retry 边界测试。
- 统一 Electron 主进程、Next API route、SSE 事件和 autoUpdater 的日志字段，至少覆盖时间、来源、级别、request/session 关联信息和错误摘要。
- 明确日志位置、级别和隐私边界，避免把用户提示词、文件内容、API key 等敏感信息写入诊断日志。

成功标准：核心性能路径有可重复检查方式；用户报告启动、更新、SSE 或 API 错误时，可以通过统一日志定位到对应模块和请求链路。

### 构建与命名 follow-up

`npm run build` 仍直接表示 Next standalone build。由于 AGENTS.md 明确提醒“不要直接运行 `next build`”，后续可以考虑新增 `build:standalone` 并让打包脚本调用该名称，以降低脚本语义歧义。是否保留 `build` 作为别名应结合 npm 包发布和现有开发习惯单独决定。

本文替代旧架构分析和 P0/P1 实施文档；后续完成剩余项时，直接更新本文，不再新增零散 follow-up 文档。

