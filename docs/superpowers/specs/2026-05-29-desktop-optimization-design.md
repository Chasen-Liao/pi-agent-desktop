# 桌面端启动、稳定性与发布优化设计

## 背景

Pi Agent Desktop 使用 Electron 启动本地 Next.js standalone/dev server，再由 BrowserWindow 加载本地 HTTP 页面。当前主窗口会在 Next server ready 后才创建并显示；如果服务启动慢或失败，用户只能感知为应用没有反应。打包配置也包含多处手动资源复制和关闭 asar 的设置，需要在可验证前提下审查。

## 目标

优化桌面端的启动可感知性、主进程稳定性、安全边界和打包发布可维护性。不改变现有 Next.js/React UI 架构，不改会话模型，不替换 Electron 技术栈。

## 非目标

- 不重写为 Vite、Tauri 或其他桌面框架。
- 不调整现有前端布局和会话交互。
- 不改变 agent API、session reader 或分支模型。
- 不新增复杂设置页。
- 不做未经打包验证的体积瘦身。

## 方案概览

采用渐进式优化：先让窗口尽早显示并呈现启动状态，再补强主进程生命周期和 Electron 安全边界，最后单独验证打包配置。这样每个阶段都可以独立回退和验证。

## 启动体验与可靠性

Electron 在确定可用端口后立即创建主窗口，窗口先加载本地启动页，展示“正在启动 Pi Agent Desktop…”。Next server 启动完成后，主窗口跳转到 `http://127.0.0.1:<port>`。

启动页只承担状态展示：启动中、启动失败、后端服务异常退出。它不复用现有 React UI，也不依赖 Next server，避免在服务不可用时无法显示错误。

`waitForServer` 保留总超时时间，但缩短轮询间隔，让 server 可用后更快进入应用。启动失败时错误写入日志，并在窗口中显示简短可理解的错误信息。

## 进程生命周期

Next 子进程的 `exit` 和 `error` 事件统一进入状态处理：

- 启动阶段失败：启动页显示失败状态，日志记录详细错误。
- 运行阶段异常退出：已打开的主窗口显示后端服务已停止，建议重启应用。
- 正常退出：仅记录日志，不弹出额外提示。

退出清理保持现有 `before-quit` 流程，但避免重复清理同一个子进程。关闭窗口继续隐藏到托盘，不改变用户习惯。

## Electron 安全边界

保留当前安全基础配置：`nodeIntegration: false`、`contextIsolation: true` 和 preload bridge。

新增窗口访问边界：

- 主窗口只允许加载本地启动页和当前进程分配的 `127.0.0.1:<port>`。
- 阻止任意新窗口创建。
- 对外部链接不在 Electron 内打开，交给系统浏览器处理。

IPC 暴露维持最小化。`select-directory` 继续只返回选择路径或 `null`，不扩大 preload API 表面。

## 打包与发布配置审查

打包优化采用验证优先策略，不直接删除配置。需要逐项确认：

- `asar: false` 是否仍然必要。
- `npmRebuild: true` 是否对当前依赖有实际价值。
- updater 相关依赖是否必须继续手动放入 `extraResources`。
- `.next/standalone/node_modules` 的复制策略是否还能保持完整运行。

任何删除或改变都必须通过 `npm run pack` 或 `npm run dist` 验证。无法验证的瘦身项只记录为后续候选，不进入本轮实现。

## 测试与验证

实现后至少验证：

1. `npm run build:electron` 通过。
2. Electron 开发模式可以打开启动页并进入应用。
3. Next server 启动失败时窗口显示错误，而不是静默无响应。
4. 外部链接不会在 Electron 内创建任意新窗口。
5. 如果调整打包配置，必须运行 `npm run pack` 或 `npm run dist`。

## 实施顺序

1. 增加启动页并改造窗口创建时机。
2. 接入启动失败和运行时子进程退出状态展示。
3. 增加导航和新窗口安全限制。
4. 审查打包配置；只在可验证时提交配置瘦身。
