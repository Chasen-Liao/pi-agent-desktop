import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import type { UpdateInfo } from "electron-updater";
import path from "path";
import { appendFileSync, mkdirSync } from "fs";
import { spawn, ChildProcess } from "child_process";
import net from "net";
import { createTray } from "./tray";
import { getStartupFailureDisposition } from "./startup-failure";
import { waitForNextServerReady } from "./server-wait";
import { killProcessTree } from "./process-tree";
import { pickApiKeys } from "./env-filter";
import { choosePort } from "./port-selection";
import { getNextRestartState, type ServerState } from "./restart-policy";
import { formatElectronLogLine, type ElectronLogLevel } from "./log-format";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let mainWindow: BrowserWindow | null = null;
let nextProcess: ChildProcess | null = null;
let isQuitting = false;
let logFilePath: string | null = null;
const DEFAULT_PORT = 30141;
let serverState: ServerState = "starting";
let activePort: number | null = null;
let startupUiReady = false;
let restartAttempts: number[] = [];

export function setQuitting(val: boolean) {
  isQuitting = val;
}
export function getQuitting(): boolean {
  return isQuitting;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function getLogFilePath(): string {
  if (!logFilePath) {
    const logDir = app.getPath("logs");
    mkdirSync(logDir, { recursive: true });
    logFilePath = path.join(logDir, "main.log");
  }
  return logFilePath;
}

function writeLog(level: ElectronLogLevel, message: string, detail?: unknown) {
  try {
    appendFileSync(getLogFilePath(), formatElectronLogLine({ level, source: "electron-main", message, detail }), "utf8");
  } catch {
    // Avoid failing app startup because diagnostics cannot be written.
  }
}

function logInfo(message: string, detail?: unknown) {
  console.log(message, detail ?? "");
  writeLog("info", message, detail);
}

function logError(message: string, detail?: unknown) {
  console.error(message, detail ?? "");
  writeLog("error", message, detail);
}

function startupPageUrl(state: "starting" | "error" | "stopped", message?: string): string {
  const url = new URL(`file://${path.join(__dirname, "startup.html").replace(/\\/g, "/")}`);
  const hash = new URLSearchParams({ state });
  if (message) {
    hash.set("message", message);
  }
  url.hash = hash.toString();
  return url.toString();
}

function showStartupState(state: "starting" | "error" | "stopped", message?: string) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  void shell;
  void serverState;
  void activePort;
  mainWindow.loadURL(startupPageUrl(state, message));
}

let startupStartedAt = Date.now();

function logStartupTiming(stage: string, detail?: unknown) {
  logInfo(`Startup timing: ${stage}`, { elapsedMs: Date.now() - startupStartedAt, detail });
}

// ---------------------------------------------------------------------------
// Port finding
// ---------------------------------------------------------------------------
function reservePort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      server.close(() => resolve(addr && typeof addr === "object" ? addr.port : port));
    });
    server.on("error", reject);
  });
}

async function findFreePort(startPort: number, maxAttempts = 10): Promise<number> {
  return choosePort({
    startPort,
    maxAttempts,
    reservePort,
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
      env: {
        ...pickApiKeys(process.env),
        NODE_ENV: process.env.NODE_ENV ?? "development",
        PORT: String(port),
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "pipe",
    });
    proc.stdout?.on("data", (d: Buffer) => logInfo(`[Next] ${d.toString().trim()}`));
    proc.stderr?.on("data", (d: Buffer) => logError(`[Next] ${d.toString().trim()}`));
    proc.on("exit", (code, signal) => handleNextProcessExit("Next.js dev server", code, signal));
    proc.on("error", (err) => handleNextProcessError("Next.js dev server", err));
    return proc;
  }

  // Production: use standalone server with ELECTRON_RUN_AS_NODE
  const standaloneDir = path.join(process.resourcesPath, "standalone");
  const serverScript = path.join(standaloneDir, "server.js");
  const proc = spawn(process.execPath, [serverScript], {
    cwd: standaloneDir,
    env: {
      ...pickApiKeys(process.env),
      NODE_ENV: process.env.NODE_ENV ?? "production",
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
    stdio: "pipe",
  });
  logInfo("Starting packaged Next.js server", { standaloneDir, serverScript, port });
  proc.stdout?.on("data", (d: Buffer) => logInfo(`[Next] ${d.toString().trim()}`));
  proc.stderr?.on("data", (d: Buffer) => logError(`[Next] ${d.toString().trim()}`));
  proc.on("exit", (code, signal) => handleNextProcessExit("Packaged Next.js server", code, signal));
  proc.on("error", (err) => handleNextProcessError("Packaged Next.js server", err));
  return proc;
}

async function restartNextServer(label: string) {
  const nextRestart = getNextRestartState({ now: Date.now(), attempts: restartAttempts, serverState, isQuitting });
  restartAttempts = nextRestart.attempts;

  if (!nextRestart.shouldRestart) {
    logError("Next.js server exited too often; automatic restart disabled", {
      attempts: nextRestart.attempts,
      windowMs: 60_000,
      label,
    });
    serverState = "stopped";
    showStartupState("stopped", `${label} 已退出`);
    return;
  }

  try {
    serverState = "starting";
    activePort = null;
    showStartupState("starting", "正在重新启动本地服务");
    const port = await findFreePort(DEFAULT_PORT);
    activePort = port;
    nextProcess = startNextServer(port);
    await waitForNextServerReady(port, nextProcess);
    showApp(port);
  } catch (err) {
    logError("Failed to restart Next.js server", err);
    serverState = "stopped";
    activePort = null;
    showStartupState("stopped", "本地服务重启失败");
  }
}

function handleNextProcessExit(label: string, code: number | null, signal: NodeJS.Signals | null) {
  logInfo(`${label} exited`, { code, signal, serverState, isQuitting });

  if (isQuitting || serverState === "stopped") {
    return;
  }

  nextProcess = null;

  if (serverState === "starting") {
    serverState = "stopped";
    showStartupState("error", "本地服务启动失败");
    return;
  }

  void restartNextServer(label);
}

function handleNextProcessError(label: string, err: Error) {
  logError(`${label} process error`, err);

  if (isQuitting || serverState === "stopped") {
    return;
  }

  nextProcess = null;

  if (serverState === "starting") {
    serverState = "stopped";
    showStartupState("error", err.message);
    return;
  }

  void restartNextServer(label);
}

function cleanup() {
  const proc = nextProcess;
  nextProcess = null;

  if (proc && !proc.killed) {
    logInfo("Killing Next.js server process");
    const error = killProcessTree(proc);
    if (error) {
      logError("Failed to kill Next.js server process tree", error);
    }
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "Pi Agent Desktop",
    icon: nativeImage.createFromPath(path.join(app.getAppPath(), "build", "icon.ico")),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  installNavigationGuards(mainWindow);
  showStartupState("starting");

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
    startupUiReady = false;
    mainWindow = null;
  });
}

function showApp(port: number) {
  activePort = port;
  serverState = "ready";
  logStartupTiming("loading app url", { port });
  mainWindow?.loadURL(`http://127.0.0.1:${port}`);
}

function isAllowedAppUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);

    if (parsed.protocol === "file:") {
      return parsed.pathname.endsWith("/startup.html");
    }

    return parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" && parsed.port === String(activePort);
  } catch {
    return false;
  }
}

function installNavigationGuards(window: BrowserWindow) {
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedAppUrl(url)) {
      event.preventDefault();
      logError("Blocked navigation", { url });
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url).catch((err) => logError("Failed to open external URL", err));
    } else {
      logError("Blocked window open", { url });
    }
    return { action: "deny" };
  });
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
function registerIpcHandlers() {
  ipcMain.handle("select-directory", async () => {
    const targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
    const result = targetWindow
      ? await dialog.showOpenDialog(targetWindow, {
          properties: ["openDirectory"],
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory"],
        });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("quit-and-install", async () => {
    logInfo("quitAndInstall requested from renderer");
    setQuitting(true);
    const { autoUpdater } = await import("electron-updater");
    autoUpdater.quitAndInstall();
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.on("before-quit", () => {
  logInfo("before-quit");
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
  startupStartedAt = Date.now();
  logStartupTiming("app ready");
  registerIpcHandlers();

  try {
    const port = await findFreePort(DEFAULT_PORT);
    logStartupTiming("port selected", { port });
    serverState = "starting";
    activePort = port;
    logInfo(`Using port ${port}`);

    createWindow();
    logStartupTiming("window created");
    createTray(mainWindow!);
    startupUiReady = true;

    nextProcess = startNextServer(port);
    logStartupTiming("next process spawned");
    logInfo("Waiting for Next.js server...");

    await waitForNextServerReady(port, nextProcess);
    logStartupTiming("next server ready");
    logInfo("Next.js server is ready");
    showApp(port);

    // Auto-update check (production only, delayed 30s)
    if (app.isPackaged) {
      setTimeout(async () => {
        try {
          const { autoUpdater } = await import("electron-updater");
          autoUpdater.autoDownload = true;
          logInfo("Checking for updates");

          // Forward update events to renderer
          autoUpdater.on("checking-for-update", () => {
            logInfo("autoUpdater checking-for-update");
          });

          autoUpdater.on("update-available", (info: UpdateInfo) => {
            logInfo("autoUpdater update-available", info);
            mainWindow?.webContents.send("update-available", { version: info.version });
          });

          autoUpdater.on("update-not-available", (info: UpdateInfo) => {
            logInfo("autoUpdater update-not-available", info);
          });

          autoUpdater.on("download-progress", (info) => {
            logInfo("autoUpdater download-progress", {
              percent: info.percent,
              transferred: info.transferred,
              total: info.total,
            });
          });

          autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
            logInfo("autoUpdater update-downloaded", info);
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
                logInfo("Update restart dialog response", { response });
                if (response === 0) {
                  setQuitting(true);
                  logInfo("Calling autoUpdater.quitAndInstall");
                  autoUpdater.quitAndInstall();
                }
              });
          });

          autoUpdater.on("error", (err) => {
            logError("autoUpdater error", err);
          });

          autoUpdater.checkForUpdates();
        } catch (err) {
          logError("Auto-update check failed:", err);
        }
      }, 30_000);
    }
  } catch (err) {
    cleanup();
    serverState = "stopped";
    activePort = null;
    const message = err instanceof Error ? err.message : String(err);
    const disposition = getStartupFailureDisposition({ uiReady: startupUiReady, message });
    logError("Failed to start:", err);

    if (disposition.shouldShowStartupPage) {
      showStartupState("error", disposition.message);
      return;
    }

    dialog.showErrorBox("启动失败", disposition.message);
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
