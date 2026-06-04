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

### P1/P2 功能与性能

- `components/FileViewer.tsx` 对大文件仍没有真正的虚拟滚动。当前已有大文件纯文本降级路径，但还不是完整的可见区域渲染方案。
- `lib/rpc-manager.ts` 仍保留内置工具名硬编码列表，应考虑从 pi agent 的工具注册结果中获取并缓存。
- P0-5 的长对话性能优化缺少可重复的性能回归验证，例如固定消息数量下的 render 耗时基准。

### 测试与工程化

- `package.json` 仍没有统一 `test` 脚本；历史新增的 `hooks/**/*.test.ts` 覆盖应纳入默认测试命令。
- 仓库还没有 GitHub Actions workflow。
- 仓库还没有 husky / lint-staged 等本地提交前检查。
- compact、FileViewer 大文件路径、Electron restart failure/retry 边界仍可补更明确的单元或集成测试。

### 构建与文档命名

- `npm run build` 仍直接表示 Next standalone build；如果继续保留 AGENTS.md 中“不要直接运行 next build”的提醒，可以考虑新增或改名为 `build:standalone`，减少脚本语义歧义。
- 本文替代旧架构分析和 P0/P1 实施文档；后续完成剩余项时，直接更新本文，不再新增零散 follow-up 文档。

### 可观测性

- 当前已有 API 层 request id 和错误日志，但还不是完整可观测性体系。
- 如果后续要支持用户问题诊断，应统一 Electron 主进程、Next API route、SSE 事件和 autoUpdater 的日志格式，并明确日志位置、级别和隐私边界。

