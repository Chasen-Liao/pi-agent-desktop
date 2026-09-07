import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const builderConfig = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");

test("native Windows and macOS app icons are included in the Electron runtime package", () => {
  assert.match(builderConfig, /-\s+build\/icon\.ico/);
  assert.match(builderConfig, /-\s+build\/icon\.icns/);
  assert.doesNotMatch(builderConfig, /-\s+build\/tray-icon\.ico/);
  assert.ok(statSync(new URL("../build/icon.ico", import.meta.url)).size > 10_000);
  const macIcon = readFileSync(new URL("../build/icon.icns", import.meta.url));
  assert.equal(macIcon.subarray(0, 4).toString("ascii"), "icns");
  assert.ok(macIcon.length > 100_000);
});
