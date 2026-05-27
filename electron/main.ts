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
        server.close(() => resolve(addr && typeof addr === "object" ? addr.port : port));
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
    title: "Pi Agent Desktop",
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
