# Electron Desktop: Known Issues

## 安装后启动无反应 (Fixed)

### 问题

NSIS 安装包 `Pi Agent-Setup-0.6.11.exe` 安装完成后，双击桌面快捷方式或开始菜单启动应用，窗口不显示，进程看似启动但无任何界面。

### 根因

electron-builder 的 `extraResources` 配置中，`from: .next/standalone` 使用 `filter: ["**/*"]` 复制文件时，**默认排除 `node_modules` 目录**（被 electron-builder 全局过滤规则拦截）。这导致打包后的 `resources/standalone/` 目录缺少 `node_modules/next` 等关键依赖。

Electron 主进程启动后，以 `ELECTRON_RUN_AS_NODE=1` 执行 `standalone/server.js`，该脚本 `require("next")` 时抛出 `MODULE_NOT_FOUND` 错误，Next.js 服务器无法启动，BrowserWindow 加载 `http://127.0.0.1:PORT` 失败，表现为白屏/无窗口。

**错误日志**：
```
Error: Cannot find module 'next'
Require stack:
- <install-path>\resources\standalone\server.js
    at Module._resolveFilename (node:internal/modules/cjs/loader:1390:15)
```

### 修复

在 `electron-builder.yml` 中，将 `node_modules` 作为独立的 `extraResources` 条目添加：

```yaml
extraResources:
  - from: .next/standalone
    to: standalone
    filter:
      - "**/*"
      - "!node_modules"          # 先排除，避免 glob 冲突
  - from: .next/standalone/node_modules   # 单独包含
    to: standalone/node_modules
  - from: .next/static
    to: standalone/.next/static
  - from: public
    to: standalone/public
```

### 验证

```powershell
# 启动 standalone 服务器确认 Next.js 可加载
$env:ELECTRON_RUN_AS_NODE = "1"
$env:PORT = "30152"
$env:HOSTNAME = "127.0.0.1"
& "Pi Agent.exe" "resources\standalone\server.js"
# 输出: ▲ Next.js 16.2.1 - Local: http://127.0.0.1:30152 ✓ Ready
```

### 影响版本

- `0.6.11` 首次 Electron 打包版本（修复前）

---

## 其他待解决问题

- **占位图标**: 当前 `icon.ico` 为程序生成的 256×256 纯色方块，需替换为正式品牌图标
- **网络环境构建**: 在无法直连 GitHub 的网络环境下，`winCodeSign`、`nsis`、`nsis-resources` 需手动下载并缓存到 `%LOCALAPPDATA%\electron-builder\Cache\`
- **asar 未启用**: 当前 `asar: false`，因 standalone 服务器需直接访问文件系统。后续可考虑启用 asar 并用 asarUnpack 排除 standalone
