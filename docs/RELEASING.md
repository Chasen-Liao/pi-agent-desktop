# Release 流程

本文档是 Pi Agent Desktop 的现役发布流程。GitHub 桌面安装包与 npm CLI 包是两条不同通道。

## GitHub Desktop Release

1. 在功能分支更新 `package.json` / `package-lock.json` 版本与 `docs/releases/vX.Y.Z.md`。
2. 运行：
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npx tsc -p electron/tsconfig.json --noEmit`
   - `npm test`
   - `npm run check:electron-deps`
   - `npm audit`

   CI（`.github/workflows/ci.yml`）：Linux 跑 `npm test`（含根目录 `middleware.test.ts`）；Windows 跑 `npm run test:windows`（路径/Electron 子集），不再全量重复单测。不上传 standalone artifact。
3. 创建 PR 到 `main`，等待 CI 全部通过并完成审查后合并。
4. 从合并后的 `main` 创建干净 worktree，执行 `npm ci` 与 `npm run dist`。
5. 核对 `release/latest.yml` 的 `version`、安装包文件名和 SHA512，然后创建并推送 `vX.Y.Z` tag。
6. 使用对应的 `docs/releases/vX.Y.Z.md` 创建 GitHub Release，并上传：
   - `Pi-Agent-Desktop-Setup-X.Y.Z.exe`
   - `Pi-Agent-Desktop-Setup-X.Y.Z.exe.blockmap`
   - `latest.yml`
7. 重新查询 GitHub Release，确认 tag、目标 commit、资产名称与大小。

Windows 安装包当前未代码签名，Release Notes 必须披露 SmartScreen 提示。

## npm Release

`npm run release` 会先执行 `npm version patch --no-git-tag-version`，然后构建 standalone 并发布 npm 包。它**不用于 GitHub Desktop Release**；当 manifest 已经是目标桌面版本时运行它会把版本继续递增。
