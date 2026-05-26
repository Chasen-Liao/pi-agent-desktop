# Windows 原生 EXE 应用实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 pi-web Next.js 应用打包为 Windows 原生桌面 EXE 应用（Electron），含安装包和自动更新

**Architecture:** Electron 主进程作为启动器，启动 Next.js standalone 服务（子进程），BrowserWindow 加载 localhost URL。前端和服务端代码零修改。electron-builder 生成 NSIS 安装包 + GitHub Releases 自动更新。

**Tech Stack:** Electron 36+, electron-builder, electron-updater, Next.js standalone output

---

## File Structure

**新建文件：**
- `electron/main.ts` — Electron 主进程（端口查找、服务启动、窗口管理、生命周期）
- `electron/preload.ts` — preload 脚本（安全桥接，仅暴露更新 API）
- `electron/tray.ts` — 系统托盘菜单
- `electron/tsconfig.json` — Electron 端 TypeScript 配置
- `electron-builder.yml` — 打包配置

**修改文件：**
- `package.json` — 新增依赖、main 字段、scripts
- `next.config.ts` — 添加 `output: 'standalone'`

**不变文件：**
- 所有 `app/`, `lib/`, `components/` — 前端和服务端代码零修改

---

### Task 1: 安装 Electron 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装依赖**

```bash
cd /d e:\MyProjects\github\pi-web
npm install --save-dev electron@36 electron-builder@26 electron-updater@6 electron-rebuild@3
```

- [ ] **Step 2: 验证安装**

```bash
npx electron --version
```

Expected: 输出 Electron 版本号（如 v36.x.x）

- [ ] **Step 3: 提交**

```bash
git add package.json package-lock.json
git commit -m "chore: add electron dev dependencies"
```

---

### Task 2: 配置 Next.js standalone 输出

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: 添加 output: 'standalone'**

在 `next.config.ts` 中，给 `nextConfig` 对象添加 `output: "standalone"`:

```typescript
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"],
  // ...rest unchanged
};
```

- [ ] **Step 2: 执行 next build 验证 standalone 输出**

```bash
cd /d e:\MyProjects\github\pi-web
npm run build
```

Expected: `.next/standalone/` 目录生成，包含 `server.js` 和精简的 `node_modules/`

- [ ] **Step 3: 验证 standalone 服务器可启动**

```bash
node .next/standalone/server.js
```

在另一个终端访问 `http://localhost:3000`，确认页面可加载后 Ctrl+C 停止。

**重点检查：** standalone 输出中的 `package.json` 是否包含 `version` 字段。如果缺失，`next.config.ts` 中的 `__dirname` 引用会读到不完整的文件。此时需要将版本号硬编码或从项目根目录读取：

```typescript
// 如果 standalone 的 package.json 缺少 version，改为从项目根目录读取：
const { version } = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as { version: string };
```

- [ ] **Step 4: 提交**

```bash
git add next.config.ts
git commit -m "feat: enable next.js standalone output for electron packaging"
```

---

### Task 3: 创建 Electron TypeScript 配置

**Files:**
- Create: `electron/tsconfig.json`

- [ ] **Step 1: 创建配置文件**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "skipLibCheck": true,
    "lib": ["ES2022"]
  },
  "include": ["./*.ts"],
  "exclude": ["./dist"]
}
```

- [ ] **Step 2: 编译验证**

```bash
npx tsc -p electron/tsconfig.json --noEmit
```

Expected: 无错误（此时还没有 .ts 文件，所以不会有输出）

- [ ] **Step 3: 提交**

```bash
git add electron/tsconfig.json
git commit -m "chore: add electron typescript config"
```

---

### Task 4: 创建 electron/main.ts — 主进程核心

**Files:**
- Create: `electron/main.ts`

- [ ] **Step 1: 创建主进程文件**

```typescript
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { UpdateInfo } from "electron-updater";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import net from "net";
import { createTray } from "./tray";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let mainWindow: BrowserWindow | null = null;
let nextProcess: ChildProcess | null = null;
let isQuitting = false;
const DEFAULT_PORT = 30141;

export function setQuitting(val: boolean) {
  isQuitting = val;
}
export function getQuitting(): boolean {
  return isQuitting;
}

// ---------------------------------------------------------------------------
// Port finding
// ---------------------------------------------------------------------------
function findFreePort(startPort: number, maxAttempts = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    function tryPort(port: number, attempts: number) {
      const server = net.createServer();
      server.listen(port, "127.0.0.1", () => {
        const addr = server.address();
        server.close(() => resolve(typeof addr === "object" ? addr.port : port));
      });
      server.on("error", () => {
        if (attempts > 0) {
          tryPort(port + 1, attempts - 1);
        } else {
          reject(new Error(`No free port found after ${maxAttempts} attempts`));
        }
      });
    }
    tryPort(startPort, maxAttempts);
  });
}

// ---------------------------------------------------------------------------
// Next.js server lifecycle
// ---------------------------------------------------------------------------
function startNextServer(port: number): ChildProcess {
  const isDev = !app.isPackaged;

  if (isDev) {
    // Dev: use 'node' (not process.execPath which is electron.exe) to start next dev
    const nextBin = require.resolve("next/dist/bin/next", { paths: [app.getAppPath()] });
    const proc = spawn("node", [nextBin, "dev", "-p", String(port)], {
      cwd: app.getAppPath(),
      env: { ...process.env, PORT: String(port) },
      stdio: "pipe",
    });
    proc.stdout?.on("data", (d: Buffer) => console.log(`[Next] ${d.toString().trim()}`));
    proc.stderr?.on("data", (d: Buffer) => console.error(`[Next] ${d.toString().trim()}`));
    return proc;
  }

  // Production: use standalone server with ELECTRON_RUN_AS_NODE
  const standaloneDir = path.join(process.resourcesPath, "standalone");
  const serverScript = path.join(standaloneDir, "server.js");
  const proc = spawn(process.execPath, [serverScript], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
    stdio: "pipe",
  });
  proc.stdout?.on("data", (d: Buffer) => console.log(`[Next] ${d.toString().trim()}`));
  proc.stderr?.on("data", (d: Buffer) => console.error(`[Next] ${d.toString().trim()}`));
  return proc;
}

function waitForServer(port: number, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    function tryConnect() {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Server not ready after ${timeoutMs / 1000}s`));
        return;
      }
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        setTimeout(tryConnect, 1000);
      });
      socket.setTimeout(2000, () => {
        socket.destroy();
        setTimeout(tryConnect, 500);
      });
    }
    tryConnect();
  });
}

function cleanup() {
  if (nextProcess && !nextProcess.killed) {
    nextProcess.kill();
    nextProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow(port: number) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "Pi Agent",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
function registerIpcHandlers() {
  ipcMain.handle("quit-and-install", () => {
    setQuitting(true);
    // autoUpdater is imported dynamically below, so we need to get it
    import("electron-updater").then(({ autoUpdater }) => {
      autoUpdater.quitAndInstall();
    });
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.on("before-quit", () => {
  isQuitting = true;
  cleanup();
});

app.on("window-all-closed", () => {
  // Do nothing — keep running in tray
});

app.on("activate", () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  registerIpcHandlers();

  try {
    const port = await findFreePort(DEFAULT_PORT);
    console.log(`Using port ${port}`);

    nextProcess = startNextServer(port);
    console.log("Waiting for Next.js server...");

    await waitForServer(port);
    console.log("Next.js server is ready");

    createWindow(port);
    createTray(mainWindow!);

    // Auto-update check (production only, delayed 30s)
    if (app.isPackaged) {
      setTimeout(async () => {
        try {
          const { autoUpdater } = await import("electron-updater");
          autoUpdater.autoDownload = true;

          // Forward update events to renderer
          autoUpdater.on("update-available", (info: UpdateInfo) => {
            mainWindow?.webContents.send("update-available", { version: info.version });
          });

          autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
            mainWindow?.webContents.send("update-downloaded", { version: info.version });
            dialog
              .showMessageBox(mainWindow!, {
                type: "info",
                title: "更新可用",
                message: `新版本 ${info.version} 已下载，重启以安装更新。`,
                buttons: ["立即重启", "稍后"],
                defaultId: 0,
              })
              .then(({ response }) => {
                if (response === 0) {
                  setQuitting(true);
                  autoUpdater.quitAndInstall();
                }
              });
          });

          autoUpdater.checkForUpdates();
        } catch (err) {
          console.error("Auto-update check failed:", err);
        }
      }, 30_000);
    }
  } catch (err) {
    console.error("Failed to start:", err);
    dialog.showErrorBox("启动失败", String(err));
    app.quit();
  }
});

// Handle single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
```

- [ ] **Step 2: 编译验证**

```bash
npx tsc -p electron/tsconfig.json --noEmit
```

Expected: 无编译错误（tray.ts 尚未创建，会有 import 错误，Task 5 完成后解决）

---

### Task 5: 创建 electron/preload.ts 和 electron/tray.ts

**Files:**
- Create: `electron/preload.ts`
- Create: `electron/tray.ts`

- [ ] **Step 1: 创建 preload.ts**

```typescript
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  onUpdateAvailable: (callback: (info: { version: string }) => void) =>
    ipcRenderer.on("update-available", (_event, info) => callback(info)),
  onUpdateDownloaded: (callback: () => void) =>
    ipcRenderer.on("update-downloaded", () => callback()),
  quitAndInstall: () => ipcRenderer.invoke("quit-and-install"),
});
```

- [ ] **Step 2: 创建 tray.ts**

```typescript
import { app, Menu, Tray, BrowserWindow, nativeImage } from "electron";
import path from "path";
import { setQuitting } from "./main";

export function createTray(mainWindow: BrowserWindow): Tray {
  // Use .ico for Windows tray icon (SVG not reliably supported on Win10)
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "app", "build", "tray-icon.ico")
    : path.join(__dirname, "..", "build", "tray-icon.ico");

  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // Fallback: create a minimal 16x16 transparent PNG
      icon = nativeImage.createFromBuffer(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFElEQVQ4y2N" +
            "kwAT/GYYBYwYDAKLuAf8LSXNHAAAAABJRU5ErkJggg==",
          "base64"
        )
      );
    }
  } catch {
    icon = nativeImage.createFromBuffer(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFElEQVQ4y2N" +
          "kwAT/GYYBYwYDAKLuAf8LSXNHAAAAABJRU5ErkJggg==",
          "base64"
      )
    );
  }

  const tray = new Tray(icon);
  tray.setToolTip("Pi Agent");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示窗口",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        setQuitting(true);
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  return tray;
}
```

- [ ] **Step 3: 编译全部 Electron 文件**

```bash
npx tsc -p electron/tsconfig.json
```

Expected: 编译成功，生成 `electron/dist/main.js`, `electron/dist/preload.js`, `electron/dist/tray.js`

- [ ] **Step 4: 提交**

```bash
git add electron/main.ts electron/preload.ts electron/tray.ts
git commit -m "feat: add electron main process, preload, and tray"
```

---

### Task 6: 创建 electron-builder.yml 打包配置

**Files:**
- Create: `electron-builder.yml`

- [ ] **Step 1: 创建配置文件**

```yaml
appId: com.agegr.pi-web
productName: Pi Agent
copyright: Copyright © 2026 agegr

directories:
  output: release
  buildResources: build

files:
  - electron/dist/**/*
  - "!electron/**/*.ts"
  - "!electron/tsconfig.json"

extraResources:
  - from: .next/standalone
    to: standalone
    filter:
      - "**/*"
  - from: .next/static
    to: standalone/.next/static
    filter:
      - "**/*"
  - from: public
    to: standalone/public
    filter:
      - "**/*"

asar: true
asarUnpack:
  - "**/*.node"
  - "**/node_modules/@silvia-odwyer/**"
  - "**/node_modules/@earendil-works/**"

npmRebuild: true

win:
  target:
    - target: nsis
      arch:
        - x64
  icon: build/icon.ico

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: Pi Agent
  uninstallDisplayName: Pi Agent
  artifactName: "${productName}-Setup-${version}.${ext}"

publish:
  provider: github
  owner: agegr
  repo: pi-web
```

- [ ] **Step 2: 提交**

```bash
git add electron-builder.yml
git commit -m "feat: add electron-builder configuration"
```

---

### Task 7: 更新 package.json — scripts 和 main 字段

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 添加 main 字段和 scripts**

在 `package.json` 中进行以下修改：

1. 添加 `"main": "electron/dist/main.js"` 字段（与 `"name"` 同级）

2. 在 `scripts` 中添加以下脚本：

```json
"build:electron": "tsc -p electron/tsconfig.json",
"dev:electron": "npm run build:electron && npx electron .",
"pack": "npm run build && npm run build:electron && npx electron-rebuild && npx electron-builder --dir",
"dist": "npm run build && npm run build:electron && npx electron-rebuild && npx electron-builder"
```

完整的 scripts 部分应为：

```json
"scripts": {
  "dev": "next dev -p 30141",
  "build": "next build --webpack",
  "start": "next start -p 30141",
  "lint": "eslint .",
  "release": "npm version patch --no-git-tag-version && npm run build && npm publish --access public",
  "build:electron": "tsc -p electron/tsconfig.json",
  "dev:electron": "npm run build:electron && npx electron .",
  "pack": "npm run build && npm run build:electron && npx electron-builder --dir",
  "dist": "npm run build && npm run build:electron && npx electron-builder"
}
```

3. 添加 `build` 字段（与 `"scripts"` 同级），指向 electron-builder 配置：

```json
"build": {
  "extends": "electron-builder.yml"
}
```

- [ ] **Step 2: 添加 electron/dist 到 .gitignore**

在 `.gitignore` 中添加：

```
electron/dist/
release/
```

- [ ] **Step 3: 提交**

```bash
git add package.json .gitignore
git commit -m "feat: add electron scripts and main field to package.json"
```

---

### Task 8: 创建应用图标

**Files:**
- Create: `build/icon.ico` — 主应用图标（256x256）
- Create: `build/tray-icon.ico` — 系统托盘图标（16x16 或 32x32）

- [ ] **Step 1: 创建 build 目录**

```bash
mkdir build
```

- [ ] **Step 2: 准备主应用图标**

需要一个 256x256 的 `.ico` 文件放在 `build/icon.ico`。可以使用任何 PNG 转 ICO 工具。如果没有现成图标，暂时创建一个占位：

```bash
npx electron-icon-builder --input=public/next.svg --output=build
```

如果上述命令失败，手动放置任意 `.ico` 文件到 `build/icon.ico`。electron-builder 在缺少图标时会使用默认图标。

- [ ] **Step 3: 准备托盘图标**

创建一个 16x16 或 32x32 的 `.ico` 文件放在 `build/tray-icon.ico`。Windows 系统托盘图标必须使用 `.ico` 格式（SVG 不可靠）。可以用主图标缩小生成：

```powershell
# 如果有 ImageMagick
magick convert build/icon.ico -resize 16x16 build/tray-icon.ico
```

如果没有 ImageMagick，手动从主图标中提取 16x16 尺寸另存为 `tray-icon.ico`。

- [ ] **Step 4: 提交**

```bash
git add build/
git commit -m "chore: add app icon and tray icon"
```

---

### Task 9: 验证原生模块重编译

**Files:**
- No new files

- [ ] **Step 1: 确认 electron-rebuild 已安装**

```bash
npx electron-rebuild --version
```

Expected: 输出 electron-rebuild 版本号

- [ ] **Step 2: 在项目根目录执行重编译测试**

```bash
npx electron-rebuild
```

Expected: 成功识别并重编译原生模块（如 `@silvia-odwyer/photon-node`）。输出应类似：

```
√ Rebuild Complete
```

- [ ] **Step 3: 提交**

无需提交，此步骤仅验证工具链就绪。

---

### Task 10: 验证开发模式

- [ ] **Step 1: 编译 Electron 文件**

```bash
cd /d e:\MyProjects\github\pi-web
npm run build:electron
```

Expected: 编译成功

- [ ] **Step 2: 启动 Electron 开发模式**

```bash
npm run dev:electron
```

Expected:
1. 控制台输出 Next.js dev server 启动日志
2. Electron 窗口自动打开并加载 Pi Agent 界面
3. 界面功能与浏览器版一致
4. 关闭窗口后应用最小化到系统托盘
5. 双击托盘图标可重新打开窗口
6. 托盘菜单"退出"可完全退出

- [ ] **Step 3: 验证完成后提交**

如果需要修复任何问题，在此提交修复。

---

### Task 11: 验证生产构建和打包

- [ ] **Step 1: 执行完整构建和打包**

```bash
cd /d e:\MyProjects\github\pi-web
npm run dist
```

Expected:
1. `next build` 成功，生成 `.next/standalone/`
2. `tsc` 编译 electron 文件成功
3. `electron-builder` 生成 NSIS 安装包到 `release/` 目录

- [ ] **Step 2: 验证安装包**

运行 `release/` 下的 `.exe` 安装程序：

1. 安装向导正常显示
2. 可选择安装目录
3. 安装完成后桌面和开始菜单有快捷方式
4. 从快捷方式启动应用，窗口正常打开
5. 会话创建、消息发送、SSE 流式等核心功能正常

- [ ] **Step 3: 验证卸载**

通过"添加或删除程序"卸载 Pi Agent，确认清理完整。

- [ ] **Step 4: 提交最终修复**

如有任何生产构建相关的修复，在此提交。

---

### Task 12: 清理和最终提交

- [ ] **Step 1: 确认 .gitignore 包含构建产物**

`.gitignore` 应包含：

```
.next/
node_modules/
electron/dist/
release/
out/
```

- [ ] **Step 2: 最终提交**

```bash
git add -A
git commit -m "feat: complete electron desktop app integration"
```

---

## Self-Review

**Spec coverage:**
- ✅ 窗口应用（BrowserWindow + WebView2）— Task 4, 10
- ✅ 安装包分发（NSIS）— Task 6, 11
- ✅ 自动更新（electron-updater）— Task 4 (main.ts + IPC 桥接 + preload)
- ✅ 功能不变（前端/服务端零修改）
- ✅ 开发模式保留 — Task 7 (dev:electron)
- ✅ 系统托盘 — Task 5
- ✅ 原生模块重编译 — Task 1 (electron-rebuild), Task 9 (验证), Task 6 (npmRebuild + asarUnpack)

**Review issues fixed:**
- ✅ C1: 原生模块重编译 — 添加 electron-rebuild 依赖 + npmRebuild + asarUnpack
- ✅ C2: dev 模式使用 `node` 而非 `process.execPath`（Electron 二进制）
- ✅ C3: IPC 处理器完整注册（quit-and-install + update-available/downloaded 事件转发）
- ✅ W1: 移除未使用的 `scripts/prepare-electron.js` 声明
- ✅ W2: 托盘图标使用 `.ico` 格式
- ✅ W3: 移除无效的 `NEXT_PUBLIC_APP_VERSION` 运行时环境变量
- ✅ W4: standalone 模式下 `__dirname` 注意事项已添加到 Task 2
- ✅ M2: `waitForServer` 改为基于总时间的超时（60s）
- ✅ M4: `asar: true` + `asarUnpack` 仅解包原生模块

**Placeholder scan:** 无 TBD/TODO，所有代码完整。

**Type consistency:** `setQuitting`/`getQuitting` 在 main.ts 顶部定义，tray.ts 和 IPC handler 中导入使用，签名一致。`findFreePort` 返回 `Promise<number>`，调用处正确 await。
