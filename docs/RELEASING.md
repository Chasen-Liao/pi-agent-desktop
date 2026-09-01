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
4. 确认 `package.json` 的 `version` 为 `X.Y.Z` 后，在合并后的 `main` 打 tag 并推送：`git tag vX.Y.Z && git push origin vX.Y.Z`。tag 必须等于 `v` + `package.json` version，否则打包 job 会失败。不要用 `npm run release` 发桌面包。
5. `.github/workflows/desktop-packages.yml` 在 GitHub-hosted runner 上并行打包并上传到该 tag 的 GitHub Release（没有 Release 则用 `docs/releases/vX.Y.Z.md` 创建）：
   - Windows：`npm run dist` → NSIS
   - Linux：`npm run dist`（预装 `fakeroot` `dpkg`）→ DEB
   - macOS：`npm run dist:mac` → Universal DMG + ZIP（`ensure-standalone-macos-universal-runtimes.mjs` + `mac.x64ArchFiles`；不要删）
   - 三端都跑 `smoke-packaged-standalone`；macOS 额外 `hdiutil verify` / `unzip -t` / `lipo` 双架构；Linux 额外 `dpkg-deb -I`
   - Actions 设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`，产物均未代码签名。手动 `workflow_dispatch` 只上传 artifact，不发 Release。
6. 工作流上传的资产：
   - `Pi-Agent-Desktop-Setup-X.Y.Z.exe`
   - `Pi-Agent-Desktop-Setup-X.Y.Z.exe.blockmap`
   - `latest.yml`
   - `Pi-Agent-Desktop-X.Y.Z-mac-universal.dmg`
   - `Pi-Agent-Desktop-X.Y.Z-mac-universal.dmg.blockmap`
   - `Pi-Agent-Desktop-X.Y.Z-mac-universal.zip`
   - `Pi-Agent-Desktop-X.Y.Z-mac-universal.zip.blockmap`
   - `latest-mac.yml`
   - `Pi-Agent-Desktop-X.Y.Z-linux-amd64.deb`
   - `latest-linux.yml`
7. 重新查询 GitHub Release，确认 tag、目标 commit、资产名称、大小，以及三份 `latest*.yml` 的 `version` 与 SHA512。

本地 fallback（Actions 失败或要复现）：干净 worktree `npm ci` 后，Windows / Linux 跑 `npm run dist`，macOS 跑 `npm run dist:mac`。Linux 打包机需要 `fakeroot` 与 `dpkg`；Debian/Ubuntu 执行 `sudo apt-get install fakeroot dpkg`，Arch 需另装 `fakeroot`、`dpkg` 与 `libxcrypt-compat`。不要另开一套版本号。

Windows 安装包当前未代码签名，Release Notes 必须披露 SmartScreen 提示。GitHub Actions 打的 macOS 包同样未签名、未公证，Release Notes 必须披露 Gatekeeper 提示。Linux 的 `.deb` 安装包通过 electron-updater 的 `DebUpdater` 自动更新：应用内下载新 `.deb` 后经 `dpkg -i` 或 `apt --allow-unauthenticated` 安装，安装时需要 root 授权提示。下载完整性由 `latest-linux.yml` 的 SHA512 校验（与 Windows NSIS 相同），但 `.deb` 本身未做 debsig，系统包管理器不会再验包签名。自动更新依赖 Release 资产中的 `latest-linux.yml`，漏传则 Linux 端收不到更新。Release Notes 必须披露未签名 deb 与 root 安装。

截至 2026-09-01：桌面 GitHub Release 流程是推 `v*` tag，由 `.github/workflows/desktop-packages.yml` 打 Windows / Linux / macOS。`v0.8.4` 及更早只有 Windows 资产。

## npm Release

`npm run release` 会先执行 `npm version patch --no-git-tag-version`，然后构建 standalone 并发布 npm 包。它**不用于 GitHub Desktop Release**；当 manifest 已经是目标桌面版本时运行它会把版本继续递增。
