# 白屏问题调查记录（#20 / #33）

- 分支：`dev/investigate-white-screen`
- 日期：2026-09-10
- 状态：分析结论，尚未修复

## 相关 issue

- [#20 对话进行当中总是突然白屏](https://github.com/Chasen-Liao/pi-agent-desktop/issues/20)
- [#33 有另外一个终端中运行时，会导致桌面白屏](https://github.com/Chasen-Liao/pi-agent-desktop/issues/33)

## 结论摘要

白屏不是一个单一根因，按「进程层」分为两类：

1. **单进程内的渲染层崩溃 / React 未捕获异常**（#20）——已修复。
2. **多进程并发访问共享状态导致的 API 异常与数据损坏**（#33）——未修复，进程内锁覆盖不到跨进程场景。

## #20 根因与现状（已修复）

- 根因：React 渲染阶段未捕获异常会卸载整棵组件树，窗口永久空白（`app/error.tsx` 注释确认）。
- 修复提交：`4035aad`（2026-08-28，与 issue 同日），含：
  - `app/error.tsx`：Next.js 全局错误边界，渲染异常显示错误页 + 重载按钮。
  - `electron/crash-recovery.ts`：`render-process-gone` 有界自动 reload（60s 窗口内最多 3 次，防 OOM/GPU 崩溃死循环）。
  - `electron/main.ts`：注册 `installCrashRecovery`。

### #20 剩余风险

- `app/error.tsx` 只捕获**渲染阶段**异常；事件处理器 / SSE 异步回调 / Promise rejection 中的异常不会被 error boundary 捕获，可能导致 UI 局部无响应但不整页白屏。
- `crash-recovery.ts` 中 reload 达到上限（`shouldReload=false`）后**只记日志、不展示任何错误页**，窗口仍可能保持空白且用户无感知。
- 未监听 `app.on("child-process-gone")`（GPU 进程崩溃等），GPU 层故障可能不被覆盖。

## #33 根因分析（未修复）

### 共享面

- CLI 入口 `bin/pi-web.js` 与桌面端都会启动 Next.js server，二者共享同一份 `~/.pi/agent/`：
  - `settings.json`（agent 配置，CLI 运行时会写）
  - `sessions/<encoded-cwd>/<ts>_<uuid>.jsonl`（会话文件）
  - `memory/ltm.sqlite`（LTM 长期记忆库）
- 桌面端与 CLI 共用同一 agent 核心库 `@earendil-works/pi-coding-agent`。

### 证据链

1. `lib/session-lock.ts` 的 `withFileLock` 是**进程内**锁（挂在 `globalThis.__piWriteLocks`），只对本 Node/Electron 进程内的写入互斥；**对 CLI 进程完全无效**。两个进程并发 append 同一 `.jsonl` 时无任何互斥，可能产生行交错/半行，导致前端加载 session 时 JSON 解析失败。
2. `lib/desktop-settings.ts` 用 `writeFileSync` **非原子写**（无 tmp+rename）；CLI 写 `settings.json` 同样存在半写窗口。server 侧 `lib/extensions-config.ts` 在请求路径中同步 `readFileSync` 读 settings，读到半截 JSON 即 `JSON.parse` 抛错 → API 500。
3. `lib/ltm/sqlite-backend.ts` 用 WAL + `busy_timeout = 5000`：双进程竞争写会在 5 秒后抛 `SQLITE_BUSY` → API 500（该异常发生在请求处理中，前端拿到非 2xx 后渲染失败）。
4. 端口冲突**不是**主因：`electron/port-selection.ts` 会自动顺延端口（默认 30141 起最多试 10 个）。

### 独立风险（需用户确认场景）

- 若「另一个终端」实际运行的是 `npm run dev`（而非打包 CLI），两个 dev server 会共享同一 `.next` 目录互相污染，同样可致白屏（项目规范已警告 `next build` 会污染 `.next/`）。

## 待验证点（需 issue 作者补充）

- #33 截图来自哪个版本（打包版 / dev 模式）？终端执行的准确命令？
- 桌面端与 CLI 是否打开了**同一个 session**？
- 白屏时刷新页面是否能恢复？
- `%APPDATA%\Pi Agent Desktop\logs\main.log` 白屏前后的日志（判断崩溃层：渲染进程 gone / Next server 退出 / API 500）。

## 建议修复方向（后续基于本分支开展）

1. **跨进程文件锁**：给 `.jsonl` / `settings.json` 写入加跨进程锁（如 `proper-lockfile` / 文件系统锁 / 原子写 tmp+rename），或至少将写盘改为原子操作。
2. **崩溃上限后兜底 UI**：`crash-recovery.ts` 达到上限时加载 `startup.html` 错误页，而非保持空白。
3. **监听 `child-process-gone`**：覆盖 GPU 进程崩溃。
4. **前端补「非渲染阶段」错误兜底**：SSE 流 / 事件处理器异常统一收口（如全局 `unhandledrejection` 上报 + 错误提示）。
5. **LTM 写竞争**：`SQLITE_BUSY` 时重试或降级为异步队列，避免请求路径直接 500。
