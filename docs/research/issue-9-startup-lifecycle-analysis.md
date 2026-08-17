# Issue #9：首次启动卡在加载页的生命周期分析

> 调研日期：2026-08-17
> 范围：GitHub issue #9、issue 创建时的 v0.7.18、v0.7.21 发布候选、相关 Git 历史与 Electron / Next.js 官方文档
> 结论性质：历史回溯与静态分析；未在 issue 报告者的机器上复现，未取得其日志

## 结论先行

**最强、且几乎可以确认与 issue #9 同批次相关的问题，是 v0.7.18 的 Next.js 16 Turbopack standalone 包漏掉了 `app-route-turbo.runtime.prod.js`。** v0.7.18 于 2026-07-29 把 `build:standalone` 从 `next build --webpack` 改成 `next build`，issue 于 2026-07-31 创建；2026-08-03 的修复提交 `44bedcc` 明确补拷该 runtime，同日 v0.7.19 发布说明直接写明这项修复解决 “Electron stuck on the loading screen after install”。这是时间、代码改动、错误机制和一方发布说明相互吻合的强证据链。

但仍需保留一个重要边界：**issue 页面没有版本号、日志、等待时长、首次/二次启动对比或评论；“彻底关闭后第二次打开正常”来自本次调研任务给出的补充症状，不在 issue 原文中。** 缺失的 runtime 是安装包内静态文件，通常不会因为原样重启而自行出现，因此它能高度解释“安装后第一次卡加载页”，却不能独立解释“同一安装、未更新、第二次必然正常”。若这一二次差异可稳定复现，还存在第二个未识别的冷启动或进程生命周期因素，需要日志才能闭环。

当前源码已包含补拷脚本、打包命令约束和回归测试；v0.7.21 还补上了 health 成功后的页面导航门槛：主进程会等待 `loadURL()` 完成，瞬时失败有限重试，生命周期改变时立即取消底层导航，只有页面真正加载成功才写入 `ready`。v0.7.21 的最终 `win-unpacked` 产物在独立用户数据目录中连续做了两次 packaged-mode 启动，并通过 Chromium remote debugging 读取 BrowserWindow 最终 URL：两次都从 `file://.../startup.html` 切换到了 `http://127.0.0.1:30141/`，首次在约 19 秒内完成，第二次约 19.1 秒。因此，该历史缺陷在当前源码和新打包产物中均未复现；但这仍不是“运行 NSIS 后的全新安装首次自动启动”验收，不能覆盖安装器、Windows Defender 和用户机器环境。

## 证据等级

| 等级 | 判断 | 依据 |
|---|---|---|
| 强 | v0.7.18 安装包存在 Turbopack standalone runtime 漏包，并会阻断 `/api/health`，使 Electron 留在启动页 | [v0.7.18 切换提交](https://github.com/Chasen-Liao/pi-agent-desktop/commit/8797414b4712f7ff18d82220fa1ef1ee21a0e7a0)、[修复提交 `44bedcc`](https://github.com/Chasen-Liao/pi-agent-desktop/commit/44bedcc82d5bf344880655dd2f9dcafc5345dec6)、[v0.7.19 发布说明](https://github.com/Chasen-Liao/pi-agent-desktop/releases/tag/v0.7.19)、[项目架构记录](../ARCHITECTURE.md#1410b-next-16-turbopack-standalone-缺-app-route-runtime2026-08-03) |
| 中强 | issue #9 很可能就是该 v0.7.18 漏包问题 | issue 发生在 v0.7.18 发布后 2 天、修复前 3 天，UI 症状一致；但 issue 未报告版本和错误日志 |
| 中 | 当前源码已防止同一种漏包再次进入正常构建链 | [`package.json:22-33`](../../package.json#L22-L33)、[`ensure-standalone-next-runtimes.mjs:1-48`](../../scripts/ensure-standalone-next-runtimes.mjs#L1-L48)，以及本次相关测试 13/13 通过 |
| 中 | 当前 v0.7.20 本机打包产物连续两次都能离开启动页 | packaged-mode 实测中 BrowserWindow 最终 URL 均为 `http://127.0.0.1:30141/`；首次约 14.6 秒，第二次约 10.0 秒 |
| 中强 | v0.7.21 最终构建产物在独立用户数据目录中连续两次都能离开启动页 | 新 `win-unpacked` 产物两轮最终 URL 均为 `http://127.0.0.1:30141/`；首次在约 19 秒内完成，第二次约 19.1 秒；但未实际运行 NSIS 安装 |
| 弱 / 未证实 | “第一次卡住、彻底退出后第二次正常”由上述漏包直接导致 | 静态 runtime 不会因重启自动补齐；issue 本身也没有记录这一行为 |

## 1. Issue 实际提供了什么

### 已确认事实

- [Issue #9](https://github.com/Chasen-Liao/pi-agent-desktop/issues/9) 标题为“软件打开一直卡在初始页面放圈圈！”，由 `Sdreamery` 于 2026-07-31 创建。
- 正文只有一张启动页截图和一句“如图所示，软件打开一直卡在初始页面放圈圈是为什么呢？”。截至调研日，issue 仍为 Open，无标签、负责人、评论、关联分支或 PR。
- issue 没有提供应用版本、Windows 版本、安装/升级方式、等待时长、日志路径、错误文本或稳定复现步骤。

### 本次任务提供、但 issue 页面未记录的观察

- “首次打开一直卡启动转圈，彻底关闭后二次打开正常”。本报告把它视作额外观察，而不是 issue 原文事实。

### 因此仍未知

- 报告者是否使用刚发布的 v0.7.18 安装包；从日期看很可能，但不能直接证明。
- 截图是在 60 秒启动超时之前还是之后；也不知道页面后来是否切换成错误态。
- 所谓“彻底关闭”是关闭窗口、托盘退出、任务管理器结束进程，还是安装器完成后再次启动。
- 两次启动之间是否发生自动更新、重装、Windows Defender 扫描完成或其他外部状态变化。

## 2. 启动页为什么会一直转：当前生命周期

以下链路在 issue 当时的 v0.7.18 已基本存在，当前 `HEAD` 仍保留：

1. Electron 取得单实例锁；如果已有实例，第二个进程立即退出，原实例只被显示/聚焦（[`electron/main.ts`](../../electron/main.ts)）。Electron 官方也说明 `requestSingleInstanceLock()` 失败意味着已有主实例，调用者应立即退出；`second-instance` 通常用于聚焦原窗口（[Electron `app` 官方文档](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata)）。
2. `app.whenReady()` 后先选端口、创建窗口，再启动本地 Next.js 子进程（[`electron/main.ts`](../../electron/main.ts)）。Electron 官方定义 `whenReady()` 只代表 Electron 初始化完成，并不代表应用自己的本地服务已就绪（[Electron `app.whenReady()`](https://www.electronjs.org/docs/latest/api/app#appwhenready)）。
3. 新窗口首先加载 `startup.html`，并在 `ready-to-show` 后展示（[`electron/main.ts`](../../electron/main.ts)）。Electron 官方说明 `ready-to-show` 代表渲染器首次绘制页面，不等于后台服务可用（[Electron `BrowserWindow`](https://www.electronjs.org/docs/latest/api/browser-window#using-the-ready-to-show-event)）。
4. 打包模式用当前 Electron 可执行文件配合 `ELECTRON_RUN_AS_NODE=1` 运行 `resources/standalone/server.js`（[`electron/main.ts`](../../electron/main.ts)）。Next.js 官方说明 `output: 'standalone'` 会生成最小 `.next/standalone/server.js`，其可运行性依赖输出文件追踪复制出的依赖集合（[Next.js `output: standalone`](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/output)）。
5. 打包模式不会只信任 stdout 的 `Ready`；它持续请求 `127.0.0.1:<port>/api/health`，只有 2xx–3xx 才算成功（[`electron/server-wait.ts:23-115`](../../electron/server-wait.ts#L23-L115)、[`electron/server-wait.ts:165-228`](../../electron/server-wait.ts#L165-L228)）。健康端点本身只返回 `{ ok: true }`（[`app/api/health/route.ts:1-3`](../../app/api/health/route.ts#L1-L3)）。
6. 只有健康检查成功后才会尝试用真正的应用 URL 替换启动页。因此，任何让 Next 子进程无法成功处理 `/api/health` 的错误，视觉结果都会先表现为启动页持续转圈。
7. 健康检查总等待上限默认为 60 秒、单次请求超时 15 秒；超过后会拒绝启动 Promise（[`electron/server-wait.ts:23-28`](../../electron/server-wait.ts#L23-L28)、[`electron/server-wait.ts:72-79`](../../electron/server-wait.ts#L72-L79)）。主流程捕获错误后会清理子进程并把启动页切到错误态（[`electron/main.ts`](../../electron/main.ts)；错误态文案见 [`electron/startup.js:12-23`](../../electron/startup.js#L12-L23)）。所以源码语义不是“无限等待”，而是“最多约 60 秒保持 starting，再显示 error”；issue 的“一直”没有精确计时，不能据此断定计时器失效。

v0.7.20 及更早版本还有一条与“health 已成功但仍停在转圈页”直接相关的生命周期缺口：`showApp()` 调用 `mainWindow?.loadURL(...)` 后没有 `await` 返回的 Promise，也没有记录失败或重试。Electron 官方说明 `loadURL()` 的 Promise 会在 `did-finish-load` 时 resolve、页面加载失败时 reject（[Electron `BrowserWindow.loadURL`](https://www.electronjs.org/docs/latest/api/browser-window#winloadurlurl-options)）。旧代码因此把“health ready”误当成了“应用页面已成功展示”；若主页面首次导航瞬时失败，旧的 startup page 可以继续留在窗口里。

v0.7.21 修复了这条缺口：初始启动与自动重启都等待 `loadURL()`，每次导航最长 15 秒，瞬时失败按 100 / 250 / 500ms 有界重试；窗口、Next 子进程或退出状态改变时立即取消。只有同一窗口、同一子进程完成导航后才写入 `ready`，耗尽或取消则进入现有错误处理并清理对应进程。

## 3. 与 issue 时间最吻合的回归：v0.7.18 Turbopack 漏包

### 时间线（事实）

| 时间（UTC+8） | 事件 | 一手证据 |
|---|---|---|
| 2026-07-29 11:56 | v0.7.18 提交把 `build:standalone` 从 `next build --webpack` 改为 `next build`，并显式启用 `turbopack: {}` | [提交 `8797414`](https://github.com/Chasen-Liao/pi-agent-desktop/commit/8797414b4712f7ff18d82220fa1ef1ee21a0e7a0) |
| 2026-07-29 12:07 左右 | GitHub Release v0.7.18 发布 Windows 安装包 | [v0.7.18 Release](https://github.com/Chasen-Liao/pi-agent-desktop/releases/tag/v0.7.18) |
| 2026-07-31 | issue #9 报告启动页一直转圈 | [Issue #9](https://github.com/Chasen-Liao/pi-agent-desktop/issues/9) |
| 2026-08-03 13:37 | 提交 `44bedcc`：在 standalone 构建后补拷全部 `*turbo*.runtime.prod.js` | [提交 `44bedcc`](https://github.com/Chasen-Liao/pi-agent-desktop/commit/44bedcc82d5bf344880655dd2f9dcafc5345dec6) |
| 2026-08-03 13:42 | 文档记录：缺 `app-route-turbo.runtime.prod.js` 时子进程可启动，但访问 App Route 报 `Cannot find module`，窗口停在启动页 | [提交 `c1fc579`](https://github.com/Chasen-Liao/pi-agent-desktop/commit/c1fc5791900b6edfb4334d5c433aa7eb90fbb837)、[`docs/ARCHITECTURE.md:724-736`](../ARCHITECTURE.md#L724-L736) |
| 2026-08-03 13:44 左右 | v0.7.19 发布说明列出 “Packaging fix (startup hang)”，明确称修复安装后卡 loading screen | [v0.7.19 Release](https://github.com/Chasen-Liao/pi-agent-desktop/releases/tag/v0.7.19) |

### 机制闭环（事实 + 推断）

- **事实**：v0.7.18 改用 Turbopack standalone；项目随后确认 NFT 输出遗漏 `next/dist/compiled/next-server/app-route-turbo.runtime.prod.js`。修复脚本头注释保留了现场错误 `Cannot find module ...app-route-turbo.runtime.prod.js`（[`scripts/ensure-standalone-next-runtimes.mjs:1-8`](../../scripts/ensure-standalone-next-runtimes.mjs#L1-L8)）。
- **事实**：Electron 的 ready gate 恰好请求 App Route `/api/health`；缺 runtime 时该 route 无法返回成功状态，Electron 就不会调用 `showApp()`。
- **推断（高置信）**：issue #9 的截图很可能是 v0.7.18 安装包触发上述链路。时间窗口、UI 表现以及项目自己的后续 release note 完全对齐。
- **不能证明**：没有 issue 机器的 `main.log`，所以无法确认它实际出现的就是该 `MODULE_NOT_FOUND`，也无法排除另一种本地服务启动失败恰好产生相同 UI。

## 4. 为什么“第二次打开正常”仍未解释

### 4.1 静态漏包与二次成功存在机制冲突

`app-route-turbo.runtime.prod.js` 位于安装资源中的 standalone `node_modules`；修复动作发生在构建阶段，把文件从开发依赖复制到 `.next/standalone`（[`scripts/ensure-standalone-next-runtimes.mjs:12-48`](../../scripts/ensure-standalone-next-runtimes.mjs#L12-L48)），随后 electron-builder 才把 `.next/standalone/node_modules` 放进安装包（[`electron-builder.yml:16-27`](../../electron-builder.yml#L16-L27)）。正常启动过程没有生成或下载这个文件的代码。

因此，在“同一个 v0.7.18 安装目录、没有更新或重装”的前提下，单纯重启不应把缺失文件变出来。也就是说：

- 若第二次成功是偶发观察，v0.7.18 漏包仍是 issue 的首要历史解释；
- 若每次全新安装都稳定表现为“第一次失败、完整退出、第二次成功”，则还存在另一个首启因素，当前证据不足以识别。

### 4.2 现有代码能说明“为何必须彻底退出”，不能说明“为何第二次一定成功”

- 普通关闭窗口不会终止应用，而是 `preventDefault()` 后隐藏到托盘；`window-all-closed` 也故意保持进程运行（[`electron/main.ts`](../../electron/main.ts)）。
- 再点一次快捷方式时，单实例锁让新进程退出，只聚焦旧窗口。因此，如果原实例的服务启动已卡住，普通“关窗口再打开”仍然看到同一状态；只有托盘退出或结束进程才会创建新的生命周期。
- `before-quit` 会清理 Next.js 子进程树（[`electron/main.ts`](../../electron/main.ts)）。这解释了完整退出为何能清掉一个瞬态坏状态，但仓库没有证据指出首启时究竟是哪一种瞬态状态。

### 4.3 尚可考虑、但证据较弱的二次差异来源

以下只是待证假设，不应在关闭 issue 时写成根因：

1. **首次冷启动被防病毒扫描或磁盘 I/O 拖慢。** 当前 gate 允许总计 60 秒，且测试覆盖“slow first health response”。本机 v0.7.20 packaged-mode 连续两次实测分别约 14.6 秒和 10.0 秒，说明同一产物确实存在可观测的冷/暖差异；但尚未在用户机器上观察到超过 60 秒。
2. **首次子进程或端口占用的瞬态失败。** 端口探测会先监听再关闭，之后才启动子进程（[`electron/main.ts`](../../electron/main.ts)），理论上存在很小的 TOCTOU 窗口；没有日志证明发生过。
3. **health 成功后的主页面导航失败。** v0.7.20 及更早版本可能静默留下 startup page；v0.7.21 会等待 Promise、有限重试并把最终失败写入主进程日志，因此可以从 `Failed to load ... after N attempts` 证伪或确认。
4. **两次启动之间实际发生了版本/安装状态变化。** v0.7.19 的确修复了安装后卡启动页，但 issue 没有时间序列信息证明用户在两次启动间更新过。

## 5. 当前状态与验证

### 当前防线（事实）

- `build:standalone` 固定为 `next build && node scripts/ensure-standalone-next-runtimes.mjs`（[`package.json:22-24`](../../package.json#L22-L24)）。
- 补拷脚本在 standalone 或 Next 源目录不存在、或找不到任何 turbo production runtime 时直接以非零状态退出，避免静默产生坏包（[`scripts/ensure-standalone-next-runtimes.mjs:25-43`](../../scripts/ensure-standalone-next-runtimes.mjs#L25-L43)）。
- 复制行为有专门测试，构建脚本也有契约测试。
- 打包模式必须取得真实 `/api/health` 成功响应，stdout 中单独出现 `Ready` 不会提前打开应用（[`electron/server-wait.ts:165-228`](../../electron/server-wait.ts#L165-L228)）。
- v0.7.21 的初始启动与自动重启都等待主页面导航完成；导航有限重试、单次超时，并在窗口/进程生命周期变化时立即取消。服务状态只有在同一生命周期页面加载成功后才变为 `ready`。

### 本次执行的验证

```text
node --test --test-force-exit electron/server-wait.test.ts scripts/ensure-standalone-next-runtimes.test.mjs package.test.ts
```

发布候选的完整测试结果为 470 tests：468 pass、2 skip、0 fail；TypeScript、定向 ESLint、Electron 编译与 Electron 运行时依赖检查均通过。覆盖快速重试与退避、导航超时、生命周期取消、底层导航停止、迟到完成隔离、health 路径、非成功响应重试、冷启动慢响应、打包模式忽略 stdout `Ready`、子进程提前退出、监听器清理、runtime 文件复制、端口选择、启动失败分流以及 build / package 脚本约束。

此外，使用 v0.7.21 新生成的 `release/win-unpacked/Pi Agent Desktop.exe`，在独立用户数据目录中做了“第一次启动 → 完整终止进程树 → 第二次启动”的 packaged-mode 验证。探针以 remote debugging 的 BrowserWindow URL 为用户症状判据，而不只看进程是否存活：

```text
第一次：BrowserWindow 到达 http://127.0.0.1:30141/，探针在约 19 秒内确认
第二次：BrowserWindow 到达 http://127.0.0.1:30141/，约 19,079 ms
判定：两次均离开 startup.html，新产物未复现卡死；每轮结束后均终止完整进程树
```

该验证执行的是 electron-builder 新产出的 packaged 二进制，但没有实际运行 NSIS 安装器，因此仍不能等同于“干净机器安装完成后第一次自动启动”的验收。这也是 issue #9 继续保持 Open 的主要证据边界。

## 6. 建议如何关闭证据缺口

若要确认 issue #9 是否已经可以正式关闭，建议在一台干净 Windows 环境上用当前 release 做一次**全新安装 + 两次冷启动**，并保留以下材料：

1. 记录安装包版本与 SHA-256；v0.7.18 Release 已公开其安装包 digest，后续版本也应同样记录。
2. 第一次启动前清空旧进程，但不要复用旧安装目录；计时到主界面或错误页。
3. 收集 Electron 日志。代码写入 `path.join(app.getPath("logs"), "main.log")`（[`electron/main.ts`](../../electron/main.ts)）；Electron 官方说明 Windows 上默认 logs 位于应用 `userData` 下（[Electron `app.getPath('logs')`](https://www.electronjs.org/docs/latest/api/app#appgetpathname)）。
4. 若涉及安装阶段，同时收集 `%TEMP%\Pi-Agent-Desktop\installer.log`（[`build/installer.nsh:5-25`](../../build/installer.nsh#L5-L25)）。
5. 在日志中定位完整阶段序列：`app ready` → `port selected` → `window created` → `next process spawned` → `[Next] ...` → `next server ready` → `loading app url`。缺在哪一段，就能把问题定位到 Electron 初始化、端口选择、子进程启动、health route 或页面加载。
6. 重复“普通关闭窗口后重开”和“托盘完整退出后重开”，验证单实例/托盘行为是否被误认为二次启动。

### 可用于判定根因的日志特征

| 日志/现象 | 结论倾向 |
|---|---|
| `Cannot find module ...app-route-turbo.runtime.prod.js` | 与 v0.7.18 已知漏包根因一致 |
| `[Next]` 已输出 ready，但 `/api/health` 始终非成功，60 秒后 `Server not ready` | Next App Route 启动/依赖问题；需看前一条 stderr |
| 子进程 `exit` / `error` 出现在 `next server ready` 前 | standalone 启动本身失败，而非前端页面问题 |
| `next server ready` 和 `loading app url` 已记录，随后出现 `Failed to load ... after N attempts` | health 已成功，失败位于 Electron 主页面导航边界；v0.7.21 会显式记录并进入错误态 |
| 第一次耗时接近或超过 60 秒，第二次显著更短，且没有模块缺失 | 更支持冷启动 I/O / 防病毒扫描假设 |

## 最终判断

- **对 issue #9 的历史解释：高置信。** v0.7.18 Turbopack standalone 漏 runtime 是最可能根因，v0.7.19 已有针对性修复和发布声明。
- **对“二次启动正常”这一补充症状：低置信、未闭环。** 现有静态漏包机制不能独立解释；需要首次与二次启动日志。
- **对当前源码是否保留同类漏包缺陷：高置信为否。** 防线、定向测试和当前 `win-unpacked` 两次 packaged-mode 启动均通过。
- **对 v0.7.20 及更早版本的页面导航生命周期缺口：高置信为是。** health 成功后未等待 `loadURL()`，一次瞬时导航失败可能永久留下启动页。
- **对 v0.7.21 的代码修复：高置信已补齐。** 主进程现在等待并有限重试页面导航，生命周期变化立即取消，成功前不写入 `ready`；issue #9 仍保持 Open，等待新安装包在报告者或干净 Windows 环境上的首次启动证据。
