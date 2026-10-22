# 2026-10-22 清理复审：三个已修问题

> **来源**：2026-10-22 对 `main` 分支做"过期测试与不必要代码"清理时的复审（8 维度扫描 + 3 视角对抗验证 + 父会话逐条复核）。
> **状态**：三项**均已修复**。本文件不再是待办清单，而是修复记录——保留它是为了解释"为什么 `PATCH /api/skills` 不存在了""为什么 `/statusline` 是这么接线的"。

| 编号 | 问题 | 类型 | 状态 |
|---|---|---|---|
| [P0](#p0-patch-apiskills-越界写任意文件) | `PATCH /api/skills` 无路径白名单，可越界改写任意文件 | 安全 | ✅ 已修 |
| [P1](#p1-statusline-死端点--斜杠命令穿透到-llm) | `/statusline` 斜杠命令穿透到 LLM；配套端点零调用 | 功能 | ✅ 已修 |
| [P2](#p2-409-信任握手链路零行为测试) | 409 信任握手链路（安全边界）无任何行为测试 | 测试缺口 | ✅ 已修 |

---

## P0: `PATCH /api/skills` 越界写任意文件 ✅

### 当时的现象

`PATCH /api/skills` 接受客户端传入的**任意** `filePath`，直接读取并原地写回该文件，全程没有路径白名单校验：

```ts
// 修复前的 app/api/skills/route.ts
const content = readFileSync(filePath, "utf8");   // ← 任意路径读
writeFileSync(filePath, updated, "utf8");         // ← 任意路径写
```

### 根因

存在**两个同语义端点，只有一个带校验**：

| 端点 | 路径校验 |
|---|---|
| `POST /api/extensions` → `lib/extensions-config.ts` | ✅ `isValidLocation`（只允许已发现的 skill，或 `<cwd>/.pi/skills` / `~/.pi/agent/skills` 的子路径） |
| `PATCH /api/skills` | ❌ 无 |

两者的 skill toggle 逻辑逐字等价，而前端 `components/SkillsConfig.tsx` 恰好用的是没校验的那个。

### 修复

**删除重复端点，而不是补一套新校验**：

- `components/SkillsConfig.tsx` 的 toggle 改调 `POST /api/extensions`（`action:"toggle"`, `type:"skill"`）
- 删除 `app/api/skills/route.ts` 的 `PATCH`，只保留 `GET`（列出技能）
- `app/api/extensions/route.test.ts` 新增越界用例：传入允许目录外的 skill 路径 → 被拒，且**目标文件未被修改**

现在 skill 开关只有一条路径，且这条路径自带白名单。

---

## P1: `/statusline` 死端点 + 斜杠命令穿透到 LLM ✅

### 当时的现象

`/statusline` 在斜杠菜单里可见（`lib/slash-commands.ts`），但发送时**没有对应的处理分支**——`hooks/agent-session/use-session-commands.ts` 的 switch 只有 `compact` / `tools` / `skills`，于是 `handled` 保持 false，命令字符串被当作普通用户消息发给模型。

同时 `app/api/statusline/route.ts`（159 行）实现完整且有 `isPathAllowedAsync` 403 校验，却**前端零调用**。

### 修复

- **接线**：`use-session-commands.ts` 增加 `case "statusline"` → `GET /api/statusline?cwd=` → 结果经 `onStatusline` 回调上传给 `AppShell`，同时以 custom 消息形式进入对话区
- **状态栏**：`StatsBar` 新增 `statusline` prop，显示分支名、ahead/behind 与脏文件计数（纯符号，不引入未本地化文案）
- **端点**：`StatuslineResponse` 类型移到 `lib/types.ts` 供前后端共享
- **防复发**：新增测试"每个内置斜杠命令都必须有 dispatch 分支"——注册了命令却没有 case 的命令会被直接测出来

---

## P2: 409 信任握手链路零行为测试 ✅

### 当时的现象

Project Trust 的 409 握手是一条**安全边界**，但整条链路没有任何行为测试：

- `lib/trust-fetch.ts` **无任何测试导入者**（4 次重试上限、取消 → 499、`POST /api/trust` 失败透传全未覆盖）
- `lib/project-trust-desktop.ts` 的 `trust-parent` / `deny` / `deny-session` 三个分支 + `default` 抛错从未被调用
- `app/api/trust/route.ts`、`app/api/agent/new/route.ts` 的 409 分支无测试
- 唯一"提到"这条链路的地方只断言"文件存在且长度 > 50 字符"

### 修复（只补测试，不改生产行为）

| 文件 | 覆盖 |
|---|---|
| `lib/trust-fetch.test.ts`（新增） | 非 409 透传、取消 → 499 且不 POST、信任后 POST + 重试、`POST` 失败透传、**4 次重试上限**、409 但非 needsTrust 载荷、409 body 不可解析 |
| `lib/project-trust-desktop.test.ts`（扩充） | `trust-parent`（父目录及其子树被信任）、无父目录时退化为自身、`deny`、`deny-session`、未知 optionId 抛错 |
| `app/api/trust/route.test.ts`（新增） | 缺 cwd → 400、非法 optionId → 400、合法决策 → 200、GET 的 gate 结构 |
| `app/api/agent/new/route.test.ts`（新增） | 未信任项目 → **409 + needsTrust 载荷**、缺 cwd → 400、目录不存在 → 400 |

两处都做了**变异验证**：把 `attempt < 4` 改成 `< 5`、去掉 `/statusline` 分支的 `handled = true`，对应测试如期失败。

### 顺带解决的可测性问题

写路由层测试时发现：30 条路由里 **23 条用 `next/server` + `@/` 别名**，`node --test` 解析不了，因此**根本写不了路由单测**；而用 `next/server.js` + 相对路径的 7 条恰好全都有测试。

本次把要测的 4 条路由改成了可解析写法，并把这条约定写进 `AGENTS.md` Key Traps。

另一个坑：真实 `~/.pi/agent` 的信任 store 会**向上继承**父目录的信任决策，若曾信任过 `%TEMP%`，它下面所有 `mkdtemp` 目录都会被判为"已信任"，依赖"未信任"状态的测试会随机失败。测试里设 `process.env.PI_CODING_AGENT_DIR` 指向临时目录即可完全隔离。

---

## 附：本次一并做的结构性调整

`getSessionOnlyTrustMap` 原先住在重模块 `lib/rpc-manager.ts` 里，导致信任相关的路由为了拿一个 globalThis Map 而拖入整个 RPC 运行时。已移到 `lib/project-trust-desktop.ts`（信任逻辑的归属地），`AGENTS.md` 与 `docs/ARCHITECTURE.md` 的 globalThis 表同步更新。
