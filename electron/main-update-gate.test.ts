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
  assert.match(source, /waitForNextServerReady\(port, nextProcess, nextServerReadyOptions\(\)\)/);
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
// The CSP header contents themselves are behaviorally covered in lib/csp.test.ts.
