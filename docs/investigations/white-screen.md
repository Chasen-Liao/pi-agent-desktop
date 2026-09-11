# 白屏问题调查记录(#20 / #33)

- 分支:`dev/investigate-white-screen`
- 日期:2026-09-10(初版分析)/ 2026-09-11(沙箱实验复现,修订结论)
- 状态:实验完成;四项修复已在本分支落地(2026-09-12,`019ac44`+`29db4f4`),#33 白屏的最终触发机制仍待用户 `main.log`

## 相关 issue

- [#20 对话进行当中总是突然白屏](https://github.com/Chasen-Liao/pi-agent-desktop/issues/20)
- [#33 有另外一个终端中运行时,会导致桌面白屏](https://github.com/Chasen-Liao/pi-agent-desktop/issues/33)

## 结论摘要(2026-09-11 实验后修订)

1. **#20 渲染层崩溃**:error boundary + 有界 reload 已修复主体;实验 E 复现了残留缺口——**崩溃达上限后窗口永久纯白,无任何错误 UI,仅记日志**。
2. **#33 跨进程并发**:初版的三条假设链实验后**只剩一条成立**(SQLITE_BUSY)。settings/.jsonl 两条链被否定:所有配置读取端都有容错,Windows 上 `.jsonl` append 实测健壮。白屏的最终触发机制仍未锁定,优先怀疑 renderer 进程级死亡(E 机制),需 issue 用户提供 `main.log` 确认。
3. 初版"settings 半写 → `JSON.parse` 抛错 → API 500"推断**不成立**:`desktop-settings.ts` 与 `extensions-config.ts` 的读取函数均有 try/catch 回退,SDK 会话创建对损坏的 settings/auth/models.json 也全部容错(实验 A/D)。

## 实验环境(沙箱隔离)

- `PI_CODING_AGENT_DIR` 环境变量可重定向 agent 目录(SDK `config.js:405-426`),且 `electron/env-filter.ts:15` 的 `PI_` 前缀允许该变量穿透 Electron → next dev 子进程。
- 全部实验在 `%TEMP%\pi-ws-repro\` 沙箱进行,**未触碰真实 `~/.pi/agent`**;PUT `/api/desktop-settings` 探针确认沙箱生效(文件落在沙箱目录)。
- 实验脚本为一次性文件(temp 目录),本文记录设计、命令与关键参数,可按此重建。

## 实验 A:settings.json 非原子写 → 撕裂读 — fs 层 RED,应用层无害

**方法**:1 个写进程循环 `writeFileSync`(与 `desktop-settings.ts:85` / `extensions-config.ts:192` 同款非原子写)+ 2 个读进程循环 `readFileSync` + `JSON.parse`(镜像 `extensions-config.ts` 的 `readSettingsFile`)。

| 场景 | 结果 |
| --- | --- |
| 2KB 负载,6s | **42.9% 请求抛错**(主因 `Unexpected end of JSON input`,含 ~3.5% 空文件读) |
| 32KB 负载,6s | **57.6% 请求抛错** |
| 原子写对照(tmp+rename+重试) | **0 / 56,402**(GREEN) |

**应用层反转(重要)**:fs 层撕裂窗口真实且高概率,但所有消费端都有容错——

- `desktop-settings.ts:73-78` `readDesktopSettings`:catch 后回退默认值;
- `extensions-config.ts:182-187` `readSettingsFile`:catch 后返回 `{}`(初版文档声称此函数裸抛,有误——try/catch 就在 182-187 行);
- SDK `createAgentSessionServices` / `ModelRuntime.create`:对损坏的 `settings.json`、`auth.json`、`models.json` 实测**全部正常创建会话服务**(沙箱实测,见实验 D)。

**结论**:损坏的 settings.json **不产生 API 500**,不是 #33 白屏的机制;真实风险是写丢配置内容(完整性),不是可用性。

**Windows 修复约束**:tmp+rename 在读者进程持有目标文件时 `renameSync` 抛 **EPERM**(实测 6 秒内 386 次重试才成功)——**原子写实现必须带 EPERM 重试循环**,否则写方直接崩溃。

## 实验 B:.jsonl 跨进程并发 — GREEN(未复现)

| 场景 | 结果 |
| --- | --- |
| 写写并发:2 进程 `appendFileSync`,4KB/32KB 行 × 400 行 | 0 撕裂、0 丢失、0 重复 |
| 读写并发:writer 持续 append + reader 整文件逐行解析 | 0 坏行(4KB/32KB 均 GREEN) |

- Windows 上单 syscall 的 append(与 SDK `appendFile(metadata.path, …)` 同型)实测健壮,行交错降级为理论风险。
- 且 `session-reader.ts:267-275` 对坏行逐行 try/catch **跳过而非抛出**,加载不会崩(初版"前端加载 session 时 JSON 解析失败"推断不成立)。
- 残余盲区:SDK 自身的 session loader 未单独测试。

## 实验 C:SQLite 跨进程写竞争 — RED(唯一实锤的破坏链)

**方法**:holder 进程 `BEGIN IMMEDIATE` 持写锁 8 秒;另一进程按 `sqlite-backend.ts:90-91` 同配置(`busy_timeout=5000` + WAL)尝试写入。

- 结果:**5503ms 后抛 `database is locked`**,确定性复现。
- **真实 API 映射**:Electron dev 应用内锁住沙箱 `ltm.sqlite` 后,`GET /api/memory/recall` 返回 **500 `{"error":"database is locked"}`**。
- 缓解面:agent 结束时的 LTM 写有安全包装(`observe-hooks.ts:140` `safeLtmAgentEndObserve` 全量 catch),不会打断会话事件流;受影响面是 `/api/memory/*` 直接调用(`recall/remember/stats/forget`)。
- 另:`close()` 时的 `wal_checkpoint(TRUNCATE)`(`sqlite-backend.ts:600-604`)在竞争下失败也只记日志,无传播。

## 实验 D:配置文件损坏 × 全消费端 — 全 GREEN

沙箱中分别放入截断的 `settings.json` / `auth.json` / `models.json`,完整镜像 `pi-runtime.ts:29-48`(`ModelRuntime.create` + `createAgentSessionServices`)逐一实测:全部创建成功。**"CLI 并发写坏配置文件 → 桌面端 API/会话故障"这条链被否定。**

## 实验 E:renderer 连续崩溃 → 永久白屏 — RED(#20 残留缺口实锤)

**方法**:`npm run dev:electron`,单条命令内 4 次 `taskkill` renderer 进程(间隔 4s,全部落在 60s 窗口内)。

**结果**:

- 前 3 次:每次 `render-process-gone` → `Reloading renderer after crash` → 自动恢复(新 renderer PID);
- 第 4 次:`Renderer crash auto-reload skipped { reason: 'killed' }` → **无任何 renderer 进程存活,窗口纯白,永不恢复**(截图确认),仅日志无任何错误 UI;
- 附带验证:4 次 kill 拉长到 60s 窗口之外时,过期 attempts 被正确过滤(`crash-recovery.ts:21`),有界逻辑本身正确——缺口只在达上限后的兜底缺失。

## #33 根因分析(实验后修订)

### 共享面(不变)

CLI 入口 `bin/pi-web.js` 与桌面端都启动完整 Next server,共享同一份 `~/.pi/agent/`(settings/auth/models.json、sessions/、memory/ltm.sqlite),共用同一 agent 核心库。

### 实验后的因果链判定

| 初版假设链 | 实验判定 |
| --- | --- |
| 1. `.jsonl` 行交错 → 加载解析失败 | **否定**:B 实验 GREEN;session-reader 逐行容错 |
| 2. settings.json 半写 → `JSON.parse` 抛错 → API 500 | **否定**:A 实验 fs 层 RED,但全部读取端容错(D 实验 GREEN) |
| 3. LTM SQLite 双进程写 → `SQLITE_BUSY` → API 500 | **确认**:C 实验 RED,`/api/memory/recall` 实测 500 |
| 4. 端口冲突 | 不变:自动顺延(`port-selection.ts:9-17`) |

### 白屏机制本身仍未锁定

- 时间线:v0.8.5 发布于 2026-09-01,#20 修复(4035aad,2026-08-28)**已包含在内**——纯渲染阶段异常应显示 error.tsx 错误页而非白屏。
- 因此 #33 的"白屏"更可能是:renderer 进程级死亡(实验 E 机制,连崩 4 次后无兜底)、dev 模式 `.next` 污染(若终端跑的是 `npm run dev`)、或尚未识别的层。
- **需要 issue 用户的 `main.log`**:白屏前若有 `Renderer process gone` / `auto-reload skipped` 即坐实 E 机制。

## 待验证点(需 issue 作者补充)

- #33 白屏时 `%APPDATA%\Pi Agent Desktop\logs\main.log` 前后内容(区分 E 机制 / server 退出 / 其他)。
- 终端执行的准确命令(`pi` CLI 还是 `npm run dev`)。
- 白屏时手动刷新(Ctrl+R)是否恢复:renderer 死亡可经刷新恢复,server 故障不能。

## 修复方向(按实验证据重新排序)

1. **crash-recovery 达上限后加载 `startup.html` 错误页**(实验 E 证明必要):`main.ts:478-480` 的 skip 分支改为 `showStartupState("stopped", …)`——server 退出路径 `main.ts:227/245` 已有同款兜底,复制即可。
2. **`/api/memory/*` 的 SQLITE_BUSY 处理**(实验 C 证明 500 真实存在):捕获后降级(返回空结果/提示)或缩短 busy_timeout + 重试。
3. **settings 写盘原子化 tmp+rename**——注意实验 A 的 **EPERM 约束,必须带重试循环**;定位为完整性修复(丢配置),而非白屏修复。
4. **监听 `child-process-gone`**(GPU 等子进程)、**`global-error.tsx`**(layout 层兜底,现有 `app/error.tsx` 依赖上层 I18nProvider)、前端 `unhandledrejection` 收口——覆盖层级缺口,优先级中。
