# 待修问题清单（2026-10-22 清理复审产出）

> **来源**：2026-10-22 对 `main` 分支做"过期测试与不必要代码"清理时的复审（工作流 8 维度扫描 + 3 视角对抗验证 + 父会话逐条复核）。
> **性质**：本清单是**待修项**，不是现役文档。三个问题均已独立复核并复现，**代码现状仍未改动**。
> **处理约定**：每项修完并合入后，删除对应小节；全部修完后删除本文件。若某项决定不做，保留小节并写明决策与理由。

| 编号 | 问题 | 类型 | 优先级 | 状态 |
|---|---|---|---|---|
| [P0](#p0-patch-apiskills-越界写任意文件) | `PATCH /api/skills` 无路径白名单，可越界改写任意文件 | 安全 | P0 | 待决策 |
| [P1](#p1-statusline-死端点--斜杠命令穿透到-llm) | `/statusline` 斜杠命令穿透到 LLM；配套端点零调用 | 功能 | P1 | 待决策 |
| [P2](#p2-409-信任握手链路零行为测试) | 409 信任握手链路（安全边界）无任何行为测试 | 测试缺口 | P1 | 待决策 |

---

## P0: `PATCH /api/skills` 越界写任意文件

### 现象

`PATCH /api/skills` 接受客户端传入的**任意** `filePath`，直接读取并原地写回该文件，**全程没有路径白名单校验**。

```ts
// app/api/skills/route.ts:29-57
const body = await req.json() as { filePath: string; disableModelInvocation: boolean };
if (!filePath) return jsonError(req, 400, "filePath required");
if (!existsSync(filePath)) return jsonError(req, 404, "file not found");
const content = readFileSync(filePath, "utf8");          // ← 任意路径读
...
writeFileSync(filePath, updated, "utf8");                // ← 任意路径写
```

该文件的 import 段只有 `NextResponse` / `fs` / `pi-coding-agent` / `api-error`——**没有引入任何路径校验函数**：

```bash
$ grep -n "isPathAllowed\|validateWritablePath\|allowedRoots" app/api/skills/route.ts
(无匹配)
```

### 根因：存在两个同语义端点，一个有校验一个没有

| 端点 | 路径校验 | 前端调用方 |
|---|---|---|
| `POST /api/extensions` → `lib/extensions-config.ts:196` | ✅ `isValidLocation`（`lib/extensions-config.ts:236`） | `components/ExtensionsConfigModal.tsx` |
| `PATCH /api/skills` | ❌ 无 | `components/SkillsConfig.tsx:555` |

两者的 skill toggle 逻辑**逐字等价**（同样的 `parseFrontmatter` + 同样的 `disable-model-invocation` 行级编辑），但只有前者有白名单：

```ts
// lib/extensions-config.ts:236-243 —— 已被使用的安全实现
const isValidLocation =
  isDiscovered ||                                    // 已发现的 skill
  isSubpath(projectSkillsDir, resolvedTarget) ||     // <cwd>/.pi/skills/...
  isSubpath(agentSkillsDir, resolvedTarget);         // ~/.pi/agent/skills/...
if (!isValidLocation) {
  throw new Error(`Skill target outside allowed skill directories: ${nameOrPath}`);
}
```

同仓库的其它写端点也都有校验，`PATCH /api/skills` 是唯一例外：

- `app/api/files/[...path]/route.ts:284` `resolveAuthorizedPath(filePath, allowedRoots)`（realpath 防符号链接）+ `:293` `validateWritablePath(realPath)`（挡 `.git/` / `node_modules/` / `.env`）
- `app/api/extensions/route.ts` → `lib/extensions-config.ts:236` `isValidLocation`

### 影响面

- 服务绑定 `127.0.0.1`，`middleware.ts` 对 `/api/*` 全方法做 Origin 校验 → **浏览器跨站请求会被拒**（`shouldApplyOriginCheck`）。
- 残余暴露面：本机任意进程可直接发请求改写任意文件。写操作是"改 frontmatter 的一行"（`disable-model-invocation: true`），但对**任意路径**都成立——包括用户主目录下的 `.md`、配置片段等；配合 symlink 可指向更敏感的位置。
- 结论：**纵深防御缺失**，不是可被网页直接利用的远程漏洞，但同一仓库其它写端点都已做防护，缺这一处属于一致性漏洞。

### 修复方案

#### 方案 A（推荐）：删除重复端点，前端改调已验证的 `POST /api/extensions`

前端 `components/SkillsConfig.tsx:550-570` 的 `toggle` 改为：

```ts
const res = await fetch("/api/extensions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "toggle",
    type: "skill",
    nameOrPath: skill.filePath,
    scope: "global",   // skill toggle 分支不消费 scope，仅 API 契约要求存在
    cwd,               // getExtensionsConfig(cwd) 需要
  }),
});
```

然后删除 `app/api/skills/route.ts` 的 `PATCH`（保留 `GET`）。

- ✅ 一次性消除越界写 + 消除"两套 skill toggle 语义"的重复实现
- ✅ 不需要新写安全代码——复用已上线的 `isValidLocation`
- ⚠️ `mutateExtensionOrSkill` 会调 `getExtensionsConfig(cwd)` 扫一遍 skill，比现在的直接读文件重；但 toggle 是低频用户操作，可接受
- ⚠️ 需核对 `scope` 在 skill 分支确实不被消费（当前代码 205-260 行未读取 `scope`，已核实）

**改动量**：`components/SkillsConfig.tsx` ~20 行；`app/api/skills/route.ts` −30 行。

#### 方案 B：保留 `PATCH /api/skills`，补齐校验

把 `lib/extensions-config.ts:236` 的 `isValidLocation` 逻辑抽成 `lib/` 共享函数（如 `lib/skills-location.ts`），在 PATCH 里复用，并追加 `realpath` 防符号链接。

- ✅ 端点与前端契约不动，diff 更小
- ❌ 保留了两套同语义实现（与本轮"消除重复"的清理方向相反）

**改动量**：`lib/` 新增 ~30 行；`app/api/skills/route.ts` ~15 行。

### 验收标准

- `app/api/skills/route.test.ts`（新增或改现有）：传入 `<cwd>` 之外的路径 → 400/403，且**目标文件未被修改**
- 传入 `<cwd>/.pi/skills/<name>/SKILL.md` → 200，`disable-model-invocation` 正确写入
- 方案 A 需额外断言：`POST /api/extensions` 的 skill toggle 在越界路径上抛错

---

## P1: `/statusline` 死端点 + 斜杠命令穿透到 LLM

### 现象 A：斜杠命令被当成普通消息发给 LLM

`/statusline` 在斜杠菜单里可见可点（`lib/slash-commands.ts:26`），但发送时**没有对应的处理分支**：

```ts
// lib/slash-commands.ts:26 —— 注册了
{ id: "statusline", label: "/statusline", insertText: "/statusline",
  description: "切换底部状态栏（窗口 + 会话 + git）", kind: "command" },
```

```ts
// hooks/agent-session/use-session-commands.ts:129-187 —— 只有三个 case
switch (cmd) {
  case "compact": ...
  case "tools": ...
  case "skills": ...
}                     // ← 没有 case "statusline"
if (handled) return;  // ← 不触发（:187）
...
onPendingPromptQueued({ id: clientMessageId, message });  // ← 原样发给 LLM
```

**用户输入 `/statusline` 的实际结果**：命令穿透 switch，字符串 `/statusline` 被当作普通用户消息提交给模型，用户看到的是模型对这串字符的回复，而不是状态栏切换。

### 现象 B：配套端点零调用

`app/api/statusline/route.ts`（159 行）**实现完整且有安全校验**：

- 聚合 git 状态：`branch` / `ahead` / `behind` / `modified` / `staged` / `untracked` / `deleted` / `lastCommit`
- `app/api/statusline/route.ts:137` `isPathAllowedAsync(cwd)` → 不在 allowed roots 返回 403
- 非 git 目录降级返回 `isRepo: false` 而非报错

但前端**零消费**：

```bash
$ git grep -n "api/statusline" -- components hooks lib electron
(无匹配)
```

响应字段 `isRepo` / `lastCommit` / `untracked` 在 `components/`、`hooks/`、`lib/` 中同样无任何引用。

### 影响面

- 功能断裂：用户按提示操作却得不到预期结果，并**多产生一次无意义的 agent 调用**（消耗 token、写入 session 历史）
- 死代码：`app/api/statusline/route.ts` 159 行 + 路由清单条目（`docs/ARCHITECTURE.md` §12）均无消费方
- 该路由**也没有任何测试**（`lib/allowed-roots.ts` 的 `isPathAllowedAsync` 两个调用方都在这里，均无测试覆盖）

### 修复方案

#### 方案 A（推荐）：接线，把原设计做完

1. `hooks/agent-session/use-session-commands.ts` 的 switch 增加 `case "statusline"`：
   - 取 `cwd`（`newSessionCwd ?? session?.cwd`）
   - `fetch(\`/api/statusline?cwd=${encodeURIComponent(cwd)}\`)`
   - 把结果渲染成 `custom` 消息（沿用 `/tools`、`/skills` 已有的 `customType` + `display: true` 模式）
2. 状态栏侧：`components/StatsBar.tsx` / `components/AppShell.tsx` 增加"显示 git 信息"开关与展示位
3. 补 `app/api/statusline/route.test.ts`

- ✅ 端点已就绪且有校验，代价集中在 UI
- ⚠️ 涉及 UI 改动，验收需要人工过一遍视觉

#### 方案 B：删除，承认不做这个功能

1. `lib/slash-commands.ts:26` 移除 `statusline` 条目
2. 删除 `app/api/statusline/route.ts`（159 行）
3. `docs/ARCHITECTURE.md` §12 路由清单移除 `/api/statusline`（39 → 38 条）
4. 清理 `lib/allowed-roots.ts` 的调用方（`isPathAllowedAsync` 届时只被 `app/api/files` 用）

- ✅ 彻底消除死端点与断裂命令，符合本轮"消除不必要代码"的方向
- ❌ 放弃 git 状态栏功能（该端点实现完整，说明原设计是想做的）

### 验收标准

- 方案 A：输入 `/statusline` → 出现 git 状态消息，**且 session 历史里不出现发给 LLM 的 `/statusline` 消息**；`hooks/agent-session/use-session-commands.test.ts` 断言该命令被 `handled`
- 方案 B：`git grep -n "statusline"` 在 `app/`、`components/`、`hooks/`、`lib/` 中零命中；`docs/ARCHITECTURE.md` 路由数与实际一致

---

## P2: 409 信任握手链路零行为测试

### 现象

Project Trust 的 409 握手是一条**安全边界**（未信任项目不加载其 extension / skill），但整条链路在 118 个测试文件中**没有任何一处行为断言**。

```bash
$ git grep -rn "409" --include=*.test.ts .        # 排除 node_modules/.next/release
lib/atomic-write.test.ts:13:  writeFileSync(target, "x".repeat(4096));   # 唯一命中，与 409 语义无关

$ git grep -rln "trust-fetch" --include=*.test.ts .
(空)                                                        # lib/trust-fetch.ts 无任何测试导入者
```

未覆盖的具体位置：

| 位置 | 未覆盖的行为 |
|---|---|
| `lib/trust-fetch.ts:12` | 4 次重试上限；超出后直接 `return fetch(input, init)` |
| `lib/trust-fetch.ts:23-28` | 用户取消 → 返回 **499** + `{error:"Trust cancelled"}` |
| `lib/trust-fetch.ts:30-37` | `POST /api/trust` 失败 → 透传该响应，不再重试 |
| `app/api/trust/route.ts:14` / `:39` | `POST` 的 `cwd` / `optionId` 校验与 `applyTrustDecision` 调用；`GET` 返回 `evaluateProjectTrust` 结果 |
| `app/api/agent/[id]/route.ts:42-48` | 未信任 cwd → 返回 **409** + `needsTrust` payload |
| `app/api/agent/new/route.ts` | 同上的 409 分支 |
| `lib/project-trust-desktop.ts:121-144` | `applyTrustDecision` 的 `trust-parent` / `deny` / `deny-session` 三个分支 + `default` 抛错 |

`lib/project-trust-desktop.test.ts` 目前只覆盖两个分支：

```bash
$ grep -n 'applyTrustDecision(project' lib/project-trust-desktop.test.ts
61:    applyTrustDecision(project, "trust", { agentDir });
79:    applyTrustDecision(project, "trust-session", { agentDir, sessionOnlyTrust: sessionOnly });
```

唯一"提到"这条链路的地方是 `lib/agent-mode-surface.test.ts:83-97`（`"UI entry points exist in source"`），但它只断言"文件存在且长度 > 50 字符"——**不可能失败**。

### 影响面

- **静默失效风险**：若 `ensureTrustThenFetch` 的重试次数被改错（>4）、或 409 分支被误改成直接透传 499 而不重新请求，信任门禁会失效——用户点"信任"后请求仍不重试、extension 不被加载，而**测试全绿**。
- 与 ponytail 审计记录的教训一致："worker 自报绿不可信"，安全边界必须有行为测试兜底。

### 修复方案

补 4 组测试（不改生产代码）：

**① `lib/trust-fetch.test.ts`（新增，约 80 行）** — stub `globalThis.fetch`，覆盖：

- 非 409 响应 → 原样透传
- 409 + `promptTrust` 返回 `null` → 499 + `{error:"Trust cancelled"}`
- 409 + `promptTrust` 返回 optionId → `POST /api/trust` 200 → 重试并返回最终响应
- `POST /api/trust` 失败 → 透传该响应
- 连续 4 次 409 → 第 5 次不再弹信任框（循环上限）
- 409 但 body 不是 `needsTrust` 载荷 → 透传

**② `lib/project-trust-desktop.test.ts`（扩充）** — 补 4 个 case：

- `trust-parent`：`getTrustParentPath` 有父目录 → 父目录置信任、当前目录置 `null`
- `trust-parent`：无父目录 → 退化为 `trust`
- `deny` → `{trusted:false, persisted:true}`
- `deny-session` → `{trusted:false, persisted:false}`
- 未知 `optionId` → 抛错（`default` 分支）

**③ `app/api/trust/route.test.ts`（新增）** — 路由层：

- `POST` 缺 `cwd` → 400；`optionId` 非法 → 400；合法 → 200 + `{success, trusted, persisted}`
- `GET` 缺 `cwd` → 400；合法 → 返回 `evaluateProjectTrust` 的 gate 结构

**④ `app/api/agent/[id]/route.test.ts`（扩充或新增）** — 409 分支：

- 未信任 cwd → 409 + body 含 `needsTrust:true` 与 `cwd`、`options`

### 验收标准

- 4 组测试全部通过
- **变异验证**：把 `lib/trust-fetch.ts:12` 的 `attempt < 4` 改成 `attempt < 5`，① 的循环上限用例如期失败；改回后恢复绿

---

## 建议执行顺序

| 顺序 | 项 | 理由 |
|---|---|---|
| 1 | **P2** | 纯补测试、不改行为、零回归风险，且能给后续 P0/P1 的改动提供安全网 |
| 2 | **P0** | 安全项；方案 A 顺带消除一处重复实现，与本轮清理方向一致 |
| 3 | **P1** | 涉及 UI 与产品决策（接线 or 删除），放最后，前两项的测试网已就位 |

> P0 与 P1 都需要产品/安全决策，建议先确认方案再动手；P2 无决策成本，可直接开工。

---

## 附录：复核命令

```bash
# P0
grep -n "isPathAllowed\|validateWritablePath\|allowedRoots" app/api/skills/route.ts   # 无匹配
git grep -n "api/skills" -- components hooks lib | grep -v "\.test\."                  # SkillsConfig.tsx:555
sed -n '236,243p' lib/extensions-config.ts                                             # isValidLocation
sed -n '284,296p' 'app/api/files/[...path]/route.ts'                                   # 对照组

# P1
grep -n "statusline" lib/slash-commands.ts hooks/agent-session/use-session-commands.ts
git grep -n "api/statusline" -- components hooks lib electron                            # 无匹配
sed -n '137,139p' app/api/statusline/route.ts                                           # isPathAllowedAsync

# P2
git grep -rn "409" --include=*.test.ts .                                                # 唯一命中与 409 无关
git grep -rln "trust-fetch" --include=*.test.ts .                                       # 空
grep -n 'applyTrustDecision(project' lib/project-trust-desktop.test.ts                 # 只 2 个分支
```
