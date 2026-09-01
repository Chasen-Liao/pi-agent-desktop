# 协作规范

本文是 Issue / PR / 日常维护的权威说明。发版只看 [docs/RELEASING.md](docs/RELEASING.md)。架构只看 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。Agent 边界看 [AGENTS.md](AGENTS.md)。

中英文都可以。一个 Issue 或 PR 只做一件用户能感知的事。

## Issue

先搜索已有 Issue / PR。新建时用 GitHub 模板。

| 类型 | 用什么 | 必写 |
|---|---|---|
| 缺陷 | Bug | 版本（`vX.Y.Z` 或 `main`）、系统、复现步骤、期望 vs 实际。桌面问题附 OS 与安装包文件名。 |
| 功能 | Feature | 要解决什么、范围、明确不做什么。 |
| 打包 / 安装 / 更新 | Packaging | 平台、安装包名、是否自动更新、`latest*.yml` 是否在 Release 上。 |
| 文档 | `documentation` 标签 | 哪份文档、哪句过期、应以哪份代码为准。 |

不要贴 API Key、auth.json、会话 `.jsonl` 全文。日志先打码。

维护者：能当场复现的再标 `bug`；范围不清先 `question`；明确不做的标 `wontfix` 并写原因。

## Pull Request

1. 从最新 `main` 开分支。前缀：
   - `dev/…` 日常开发（修 bug、小功能）
   - `future/…` 较大或尚未排期的功能
   - `docs/…`、`ci/…`、`release/vX.Y.Z` 仍可用
   不要再用 `feat/`。
2. 标题用 `fix` / `feat` / `docs` / `ci` / `chore`，必要时加范围，例如 `fix(ltm): …`。
3. 正文写清：**Why**、**Scope**、**Out of scope**、**Verification**（跑过哪条命令）。
4. 用户可见文案改 `lib/i18n/dictionaries.ts` 的 `en` 与 `zh-CN`，不要硬编码。
5. 相关测试跟改动走。全量 `npm test` 必须带 `--test-force-exit`（脚本已带，不要去掉）。
6. **不要在开发机跑 `next build` / `npm run build`**：会污染 `.next/`，弄坏 `npm run dev`。生产构建交给 CI 的 `build (next.js)` 或 `npm run dist`。
7. 等 CI 全绿：`lint · typecheck · test`、`test (windows)`、`test (macOS)`、`build (next.js)`。Fork 第一次跑 Actions 需要维护者 **Approve and run workflows**。
8. 合并默认 **Create a merge commit**，保留 PR 内 commit 作为 bisect 点。只有「单 commit 的纯文档/笔误」才 squash。
9. 不要直接推 `main`。不要用 `npm run release` 发桌面包（会 bump patch 并走 npm）。

## 维护节奏

- `main` 只收已过 CI 的 PR。
- 发版：同一 PR 里改 `package.json` + lock + `docs/releases/vX.Y.Z.md`，合入后再 `git tag vX.Y.Z && git push origin vX.Y.Z`。tag 必须等于 `v` + `package.json` 的 `version`。
- 桌面包由 `.github/workflows/desktop-packages.yml` 打 Windows / macOS / Linux。三端和三份 `latest*.yml` 都在 GitHub Release 上才算该版本发完。
- 只有该 tag **尚未完整发布**（例如缺 macOS）时，才允许说明原因后移动 tag 重跑打包。日常不要 force-push tag，也不要另开一套版本号补包。
- 打包陷阱（不要删、不要绕）：`ensure-standalone-*-runtimes.mjs`、`dereference-standalone-symlinks.mjs`、`mac.x64ArchFiles`（必须显式包含 `standalone/.next`）。细节在架构文档 §14.10。

## 不要提交

`node_modules/`、`.next/`、`release/`、`.sessions/`、`nul`、密钥和本机会话数据。
