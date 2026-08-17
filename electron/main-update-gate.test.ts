import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

test("main process quit-and-install is gated on update download state", () => {
  assert.match(source, /decideQuitAndInstall\(updateInstallState\)/);
  assert.match(source, /markUpdateDownloaded\(updateInstallState/);
  assert.match(source, /if \(!decision\.allowed\)/);
  // Must not call quitAndInstall unconditionally in the IPC handler
  assert.doesNotMatch(
    source,
    /ipcMain\.handle\("quit-and-install", async \(\) => \{\s*logInfo\("quitAndInstall requested from renderer"\);\s*setQuitting\(true\);\s*const \{ autoUpdater \} = await import\("electron-updater"\);\s*autoUpdater\.quitAndInstall\(\);/
  );
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

test("electron csp builder pins loopback port", () => {
  const cspSource = readFileSync(new URL("./csp.ts", import.meta.url), "utf8");
  assert.match(cspSource, /connect-src 'self' http:\/\/127\.0\.0\.1:\$\{port\}/);
  assert.match(cspSource, /default-src 'self'/);
  assert.match(cspSource, /img-src 'self' data: blob:/);
});
