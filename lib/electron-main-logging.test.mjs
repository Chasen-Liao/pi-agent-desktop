import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");

test("electron main process writes diagnostics to an app log file", () => {
  assert.match(mainSource, /main\.log/);
  assert.match(mainSource, /appendFileSync/);
  assert.match(mainSource, /app\.getPath\("logs"\)/);
  assert.match(mainSource, /function logInfo/);
  assert.match(mainSource, /function logError/);
});

test("electron main process logs server and updater lifecycle", () => {
  assert.match(mainSource, /\[Next\]/);
  assert.match(mainSource, /update-available/);
  assert.match(mainSource, /update-downloaded/);
  assert.match(mainSource, /download-progress/);
  assert.match(mainSource, /checkForUpdates/);
  assert.match(mainSource, /quitAndInstall/);
});

test("electron main process terminates the packaged server process tree on Windows", () => {
  assert.match(mainSource, /killProcessTree\(proc\)/);
  assert.match(mainSource, /Failed to kill Next\.js server process tree/);
});
