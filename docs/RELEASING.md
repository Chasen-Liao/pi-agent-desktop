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

   CI（`.github/workflows/ci.yml`）：Linux 跑 `npm test`（含根目录 `middleware.test.ts`）；Windows 跑 `npm run test:windows`；macOS 跑 `npm run test:macos`。平台任务只覆盖路径、Electron 与打包配置子集，不再全量重复单测，也不上传 standalone artifact。
3. 创建 PR 到 `main`，等待 CI 全部通过并完成审查后合并。
4. 从合并后的 `main` 创建干净 worktree并执行 `npm ci`：
   - Windows 运行 `npm run dist`，生成 NSIS 安装包。
   - macOS 运行 `npm run dist:mac`，生成 Intel + Apple Silicon Universal DMG 与 ZIP。
   - macOS 构建会用 `npm pack` 下载 standalone 缺失架构的 Sharp/libvips 可选包；构建机需要能访问 npm registry。不要绕过 `ensure-standalone-macos-universal-runtimes.mjs`，也不要删除 `mac.x64ArchFiles`。
5. 核对更新元数据中的 `version`、文件名和 SHA512：Windows 为 `release/latest.yml`，macOS 为 `release/latest-mac.yml`。两端产物都确认后再创建并推送 `vX.Y.Z` tag。
6. 使用对应的 `docs/releases/vX.Y.Z.md` 创建 GitHub Release，并上传：
   - `Pi-Agent-Desktop-Setup-X.Y.Z.exe`
   - `Pi-Agent-Desktop-Setup-X.Y.Z.exe.blockmap`
   - `latest.yml`
   - `Pi-Agent-Desktop-X.Y.Z-mac-universal.dmg`
   - `Pi-Agent-Desktop-X.Y.Z-mac-universal.dmg.blockmap`
   - `Pi-Agent-Desktop-X.Y.Z-mac-universal.zip`
   - `Pi-Agent-Desktop-X.Y.Z-mac-universal.zip.blockmap`
   - `latest-mac.yml`
7. 重新查询 GitHub Release，确认 tag、目标 commit、资产名称与大小。

macOS 产物发布前还应运行 `hdiutil verify release/*.dmg`、`unzip -t release/*-mac-universal.zip`，并用 `lipo -archs "release/mac-universal/Pi Agent Desktop.app/Contents/MacOS/Pi Agent Desktop"` 确认输出同时包含 `x86_64 arm64`。

Windows 安装包当前未代码签名，Release Notes 必须披露 SmartScreen 提示。macOS 构建会在钥匙串中存在有效 Developer ID 证书时自动签名，并在配置了 electron-builder 支持的 Apple 凭据时公证；没有签名或公证的发布包必须在 Release Notes 披露 Gatekeeper 提示。

截至 2026-08-31：最新 GitHub Release 仍是 `v0.8.4`，资产只有 Windows 安装包。macOS Universal 打包已合入 `main`（#22），尚未随 Release 发布。macOS 产物可由有 Write 权限的协作者在 macOS 上执行 `npm run dist:mac` 后，上传到**同一** `vX.Y.Z` tag；不要另开一套版本号。

## npm Release

`npm run release` 会先执行 `npm version patch --no-git-tag-version`，然后构建 standalone 并发布 npm 包。它**不用于 GitHub Desktop Release**；当 manifest 已经是目标桌面版本时运行它会把版本继续递增。
