import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");
const traySource = readFileSync(new URL("../electron/tray.ts", import.meta.url), "utf8");
const builderConfig = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");

test("desktop window uses the packaged purple app icon", () => {
  assert.match(mainSource, /BrowserWindow\(\{/);
  assert.match(mainSource, /icon:\s*nativeImage\.createFromPath/);
  assert.match(mainSource, /build["']?,\s*["']icon\.ico/);
});

test("tray uses the same packaged purple app icon instead of the broken placeholder", () => {
  assert.match(traySource, /build["']?,\s*["']icon\.ico/);
  assert.doesNotMatch(traySource, /tray-icon\.ico/);
});

test("purple app icon is included in the Electron runtime package", () => {
  assert.match(builderConfig, /-\s+build\/icon\.ico/);
  assert.doesNotMatch(builderConfig, /-\s+build\/tray-icon\.ico/);
  assert.ok(statSync(new URL("../build/icon.ico", import.meta.url)).size > 10_000);
});
