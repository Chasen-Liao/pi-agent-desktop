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
