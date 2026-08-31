# Electron 36 → 43 升级方案

> 日期：2026-08-26 · 分支：`feat/electron-43-upgrade` · 状态：已落地（历史方案，勿当现役任务）
> Electron 43.4.1 已在 `main`。macOS `utilityProcess` 由 #22 于 2026-08-31 完成；Windows/Linux 仍走 `ELECTRON_RUN_AS_NODE`。
> 决策来源：bounded council（oracle-fork + reviewer，2 passes，已收敛）

## 1. 背景与动机

当前锁定 `electron ^36.9.5`（Chromium 136 / Node 22.14）。Electron 36 已于 **2025-10-28 停止安全支持**，至今约 10 个月无补丁；支持窗口仅最近 3 个 major（41/42/43）。本项目为渲染本地 web 内容并管理用户 API key 的桌面应用，缺失 Chromium 136→150 约 14 个大版本的安全修复（含多个 renderer RCE / sandbox escape，以及影响本版本线的 WebUSB 设备 ID 校验缺陷 CVE-2026-34766 等，修复于 38.8.6/39.8.0/40.7.0），必须升级。

## 2. 目标版本裁决：Electron ^43.4.x（单目标）

| 候选 | 裁决理由 |
|---|---|
| **43.4.x ✅** | 最新稳定（Chromium 150 / Node 24.18），支持期至 **2027-01-05**；#50040 已修复且贯穿 40+；冷启动优化白拿 |
| 42.x ❌ | 支持期仅至 2026-10-20（约 8 周），落地即面临第二次强制升级；与 43 同跨 Node 22→24，无风险差异 |
| 41.x ❌ | 一周内 EOL |

关键证据：GitHub electron/electron[#50040](https://github.com/electron/electron/issues/50040)（Windows frameless `close()` 自 v39.6.1 静默崩溃）状态 **Closed**，修复落地 ≥39.8.1 并回移贯穿后续 major（Theia #17328 引用、Cursor 40.10.3 实证包含）。本项目 `titleBarStyle:"hidden"` 场景不受影响。

**唯一残余条件**：新分支上实证通过 ELECTRON_RUN_AS_NODE spawn 的 Next standalone server.js（Node 24 + turbo runtime）全链路 smoke。若实测失败，才回退讨论 42.9.x 或捆绑独立 node.exe 方案。

## 3. 变更清单

| 文件 | 变更 |
|---|---|
| `package.json:55` | `"electron": "^36.9.5"` → `"^43.4.x"`（用 `npm view electron version` 解析最新补丁号） |
| `package.json:69-70` | `allowScripts` 的 `"electron@36.9.5": true` → `"electron@43.4.1": true`（实测 npm 仅接受精确版本，^/~ 范围被设计禁止；后续 bump 用 `npm approve-scripts electron` 自动改写 pin） |
| `package.json:69-70+` | devDependencies 显式新增 `"fs-extra": "^8.1.0"`：Electron 43 构建链升级后不再把 fs-extra@8 提升到根，而 builder extraResources 与依赖检查依赖根级布局，显式钉住恢复原状 |
| `package-lock.json` | 刷新（锁点 :31 / :10192-10193） |
| `docs/ARCHITECTURE.md:826` | 版本引用同步 |
| `docs/architecture.html:1269` | 版本引用同步 |

**不改**：`docs/releases/v0.8.0.md:17`、`docs/ARCHITECTURE-OPTIMIZATION-REVIEW-2026-06-26.md:37`（历史存档）；electron-builder.yml 与 builder 26.15.3（无已知硬阻塞，v27 迁移另案）；`lib/electron-updater-runtime-deps.mjs`（全文版本无关，已核实）。

## 4. 验证计划

### 自动化
1. `npm run dev:electron` — dev 模式（系统 node 跑 next dev）
2. `npm run dist` — 生产打包链路：
   - `smoke-packaged-standalone.mjs` + `smoke-standalone-server.mjs` 以 `ELECTRON_RUN_AS_NODE=1` 启动 standalone server.js，验 `/api/health` `/api/sessions` `/api/auth/providers`
   - `check:electron-deps` 钩子重跑（electron-updater ^6.8.9 兼容性检查）
   - NSIS 产物安装实测一次冷启动

### GUI 手测清单（零自动化覆盖，逐项过）
- [ ] tray 显隐 / 双击还原
- [ ] frameless 关闭到托盘（`main.ts` close → preventDefault + hide）、tray 退出路径
- [ ] second-instance 还原窗口
- [ ] `setTitleBarOverlay` 主题切换视觉正常
- [ ] autoUpdater 检查更新 + quitAndInstall 流程
- [ ] 一条完整 agent 对话链路（会话创建 → 流式回复 → fork）

## 5. 回滚策略

- 回滚锚点：main 分支 lockfile + 当前 HEAD tag（升级前打 `pre-electron-43` tag）
- 失败处置矩阵：ELECTRON_RUN_AS_NODE × Next turbo runtime 启动失败 → 先确认 `ensure-standalone-next-runtimes.mjs` 已把 turbo runtime 文件复制进 `.next/standalone`（注：该脚本为纯 cpSync 复制，无 Node ABI 维度，勿按 ABI 排查），再以 smoke 的 `/api/health` 报错定位；仍失败 → 回退评估 42.9.x 或捆绑独立 node.exe

## 6. 已知妥协与后续任务

1. **runAsNode fuse 保持开启**（有意架构妥协）：官方将 ELECTRON_RUN_AS_NODE 定性为攻击面并建议改用 utilityProcess 缓解（官方同时反驳了相关 CVE 的严重性定性，非 deprecated）。macOS packaged server 已于 2026-08-31（#22）改为 `utilityProcess.fork`；Windows/Linux 仍 `ELECTRON_RUN_AS_NODE`。
2. **ASAR Integrity 不纳入本次**（39+ 已转正，asar:true 且无原生模块，成本低）：遵循最小变更原则，升级收敛后单独小任务启用。

## 7. Council 决策记录

- Roster：`oracle`（fallback 规则，context-aware + forked）+ `reviewer`（runtime 默认上下文）；无 `council-*` profile
- Passes：2（Pass 1 独立报告 → supervisor 注入新证据 S1-S4 交叉质询）→ 收敛，未用满争议上限
- 结论演变：Oracle Pass 1 主张"双版本实验矩阵"、Reviewer Pass 1 主张"42.x 钉 42.3.3"；#50040 修复确认后双双改为 **直接升 43.4.x**（recommendationChanged: 双 true）
- Reviewer 全仓 grep 复核：除第 3 节所列外无其他失效的硬编码版本引用
- Run ids：Pass 1 = `9af5db6d`（advisor-oracle `9264782c` / advisor-reviewer `270093bc`）；Pass 2 = `50168977`（cross-oracle `c703d0db` / cross-reviewer `61bec1a0`）
- 残余 owner decisions：目标版本（已由新证据裁决为 43.4.x）；ASAR Integrity 归属（裁为后续任务）；fuse/utilityProcess 排期（另立任务）

## 参考

- [Electron releases](https://releases.electronjs.org) / [schedule](https://releases.electronjs.org/schedule) / [endoflife.date/electron](https://endoflife.date/electron)
- [Electron 43 博文](https://electronjs.org/blog/electron-43-0)（启动快照、32 位终止宣告）
- [Fuses / runAsNode CVE 声明](https://electronjs.org/blog/statement-run-as-node-cves)
- CVE：[CVE-2026-34766](https://nvd.nist.gov/vuln/detail/CVE-2026-34766)（WebUSB 校验缺陷，Medium ~5.4，≤40.7.0 均受影响，本项目旧版在列）、CVE-2026-54257（Node Buffer 越界，Critical，仅影响 42.3.1–42.3.2，43.x 天然包含）

> 引用核验（2026-08-26，研究子代理 6/6）：全部链接有效；#50040 修复首发于 v39.8.1（PR #50054，Also in 40/41）；Electron 43 官方博客宣告 32 位预编译终止。
> 执行核验（2026-08-27）：allowScripts 范围写法经 npm 源码实证否决（`@npmcli/arborist/lib/script-allowed.js` 仅收精确版本），实现采精确 pin；fs-extra 根级钉住为计划外必要补充（见变更清单）。
> 父会话终审（reviewer 子代理因模型注册失效不可用，由父代理代行）：全部窗口/托盘 API 在 Electron 43 文档中稳定无弃用；#45958（Windows overlay 深色模式不生效）为已知外观级 issue，恰好命中 `set-theme`→`setTitleBarOverlay` 路径，手测时重点确认；GUI 手测风险排序：① frameless 关闭到托盘 > ② autoUpdater quitAndInstall（无第二签名版本可实装，只能验到“检查+下载”） > ③ setTheme 视觉 > ④ tray 双击还原 > ⑤ second-instance > ⑥ 完整对话链路（后两者与桌面壳升级无关）。
