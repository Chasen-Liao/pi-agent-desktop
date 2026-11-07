import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

test("main process quit-and-install is gated on update download state", () => {
  assert.match(source, /decideQuitAndInstall\(updateInstallState\)/);
  assert.match(source, /markUpdateDownloaded\(updateInstallState/);
  // The IPC handler must refuse before download, and the only
  // autoUpdater.quitAndInstall() call site must sit after that gate.
  const handlerIdx = source.indexOf('ipcMain.handle("quit-and-install"');
  assert.ok(handlerIdx >= 0, "quit-and-install IPC handler expected");
  const gateIdx = source.indexOf("decideQuitAndInstall(updateInstallState)", handlerIdx);
  const refusedIdx = source.indexOf("if (!decision.allowed)", gateIdx);
  const installIdx = source.indexOf("autoUpdater.quitAndInstall()", handlerIdx);
  assert.ok(gateIdx > handlerIdx, "gate decision must run inside the handler");
  assert.ok(refusedIdx > gateIdx, "refusal branch must follow the gate");
  assert.ok(installIdx > refusedIdx, "quitAndInstall must only run after the gate allows");
  // The only other allowed call site is the update-downloaded restart dialog:
  // that event fires only after a completed download, and
  // markUpdateDownloaded runs before the dialog that leads to the install.
  const secondInstallIdx = source.indexOf("autoUpdater.quitAndInstall()", installIdx + 1);
  if (secondInstallIdx !== -1) {
    const downloadedIdx = source.indexOf('autoUpdater.on("update-downloaded"');
    const markIdx = source.indexOf("markUpdateDownloaded(updateInstallState", downloadedIdx);
    assert.ok(downloadedIdx !== -1, "update-downloaded handler expected");
    assert.ok(markIdx > downloadedIdx, "update-downloaded handler must mark install state first");
    assert.ok(secondInstallIdx > markIdx, "second quitAndInstall must run inside the update-downloaded flow");
    assert.equal(
      source.indexOf("autoUpdater.quitAndInstall()", secondInstallIdx + 1),
      -1,
      "no further quitAndInstall call sites are allowed"
    );
  }
});

test("packaged readiness requires HTTP health", () => {
  assert.match(source, /requireHttpHealth:\s*app\.isPackaged/);
  assert.match(source, /waitForNextServerReady\(port, nextProcess, \{\s*requireHttpHealth:\s*app\.isPackaged\s*\}\)/);
});

test("packaged macOS server uses a background utility process", () => {
  const packagedStart = source.indexOf("const serverEnv =");
  const monitorStart = source.indexOf("function monitorNextServerProcess", packagedStart);
  assert.ok(packagedStart >= 0 && monitorStart > packagedStart);
  const packagedSource = source.slice(packagedStart, monitorStart);
  assert.match(packagedSource, /process\.platform === "darwin"/);
  assert.match(packagedSource, /utilityProcess\.fork\(serverScript/);
  assert.match(packagedSource, /serviceName: "Pi Agent Next Server"/);
  const darwinBranchStart = packagedSource.indexOf(
    'process.platform === "darwin"',
  );
  const fallbackBranchStart = packagedSource.indexOf(
    ": wrapChildServerProcess",
    darwinBranchStart,
  );
  assert.ok(fallbackBranchStart > darwinBranchStart);
  assert.doesNotMatch(
    packagedSource.slice(darwinBranchStart, fallbackBranchStart),
    /process\.execPath|ELECTRON_RUN_AS_NODE/,
  );
});

test("main waits for app navigation before marking the server ready", () => {
  const awaitedShowAppCalls = source.match(/await showApp\(port\)/g) ?? [];
  assert.equal(awaitedShowAppCalls.length, 2, "initial startup and restart must both await navigation");

  const showAppStart = source.indexOf("async function showApp(port: number): Promise<void>");
  const showAppEnd = source.indexOf("\nfunction isAllowedAppUrl", showAppStart);
  assert.ok(showAppStart >= 0 && showAppEnd > showAppStart, "showApp implementation must exist");

  const showAppSource = source.slice(showAppStart, showAppEnd);
  const navigationIndex = showAppSource.indexOf("await loadPageWithRetry");
  const readyIndex = showAppSource.indexOf('serverState = "ready"');
  assert.ok(navigationIndex >= 0, "showApp must await bounded app navigation");
  assert.ok(readyIndex > navigationIndex, "ready must only be set after navigation completes");
  assert.match(showAppSource, /nextProcess !== proc/);
  assert.match(showAppSource, /proc\.exitCode !== null/);
  assert.match(showAppSource, /signal: navigationAbort\.signal/);
  assert.match(showAppSource, /window\.webContents\.stop\(\)/);
});

test("main process CSP uses shared electron CSP builder", () => {
  assert.match(source, /import \{ buildElectronCspHeader \} from "\.\/csp"/);
  assert.match(source, /buildElectronCspHeader\(port\)/);
});

test("main process registers manual update check, download, and app-info IPC handlers", () => {
  assert.match(source, /ipcMain\.handle\("get-app-info"/);
  assert.match(source, /ipcMain\.handle\("get-update-status"/);
  assert.match(source, /ipcMain\.handle\("check-for-updates"/);
  assert.match(source, /ipcMain\.handle\("download-update"/);
  assert.match(source, /mainWindow\.webContents\.send\("update-status"/);
});

test("main process installs right-click context menu and configurable window close behavior", () => {
  assert.match(source, /installContextMenu\(mainWindow\)/);

  const contextMenuStart = source.indexOf("function installContextMenu(window: BrowserWindow)");
  const navGuardsStart = source.indexOf("function installNavigationGuards", contextMenuStart);
  assert.ok(contextMenuStart >= 0 && navGuardsStart > contextMenuStart);
  const contextMenuSource = source.slice(contextMenuStart, navGuardsStart);
  assert.match(contextMenuSource, /window\.webContents\.on\("context-menu"/);
  assert.match(contextMenuSource, /if \(window\.isDestroyed\(\)\) return;/);
  assert.match(contextMenuSource, /buildContextMenuTemplate\(params/);
  assert.match(contextMenuSource, /locale:\s*app\.getLocale\(\)/);
  assert.match(contextMenuSource, /onCopyLink:\s*\(url\)\s*=>\s*clipboard\.writeText\(url\)/);
  assert.match(contextMenuSource, /Menu\.buildFromTemplate\(template\)/);
  assert.match(contextMenuSource, /menu\.popup\(\{\s*window\s*\}\)/);

  const closeStart = source.indexOf('mainWindow.on("close"');
  const closedStart = source.indexOf('mainWindow.on("closed"', closeStart);
  assert.ok(closeStart >= 0 && closedStart > closeStart);
  const closeSource = source.slice(closeStart, closedStart);
  const fallbackIdx = closeSource.indexOf("closeAction ?? readCloseActionFromDisk()");
  const decisionIdx = closeSource.indexOf("decideWindowCloseAction(");
  const hideBranchIdx = closeSource.indexOf('decision === "hide-to-tray"');
  const preventDefaultIdx = closeSource.indexOf("e.preventDefault()", hideBranchIdx);
  const hideCallIdx = closeSource.indexOf("mainWindow?.hide()", hideBranchIdx);
  const quitBranchIdx = closeSource.indexOf('decision === "quit-app"');
  const setQuittingIdx = closeSource.indexOf("isQuitting = true", quitBranchIdx);
  const quitTimeoutIdx = closeSource.indexOf("setTimeout(() => app.quit())", quitBranchIdx);

  assert.ok(fallbackIdx >= 0, "close handler must fall back to readCloseActionFromDisk()");
  assert.ok(decisionIdx > fallbackIdx, "decideWindowCloseAction must use effectiveCloseAction");
  assert.ok(hideBranchIdx > decisionIdx, "hide-to-tray branch must follow decision");
  assert.ok(preventDefaultIdx > hideBranchIdx, "hide-to-tray must prevent default close");
  assert.ok(hideCallIdx > preventDefaultIdx, "hide-to-tray must hide mainWindow");
  assert.ok(quitBranchIdx > hideCallIdx, "quit-app branch must follow hide-to-tray branch");
  assert.ok(setQuittingIdx > quitBranchIdx, "quit-app must mark isQuitting = true before quitting");
  assert.ok(quitTimeoutIdx > setQuittingIdx, "quit-app must schedule app.quit()");

  const setCloseActionStart = source.indexOf('ipcMain.on("set-close-action"');
  assert.ok(setCloseActionStart >= 0, "set-close-action IPC listener expected");
  const setCloseActionSource = source.slice(setCloseActionStart, setCloseActionStart + 200);
  assert.match(setCloseActionSource, /if \(isCloseAction\(action\)\)/);
  assert.match(setCloseActionSource, /closeAction = action/);
});
// The CSP header contents themselves are behaviorally covered in lib/csp.test.ts,
// which also asserts electron/csp.ts and lib/csp.ts emit identical headers.


