import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ELECTRON_UPDATER_RUNTIME_PACKAGES,
  missingFromBuilderConfig,
  missingFromNodeModules,
} from "./electron-updater-runtime-deps.mjs";

const config = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("electron updater runtime dependencies are packaged with the Electron app", () => {
  for (const packageName of ELECTRON_UPDATER_RUNTIME_PACKAGES) {
    const escapedName = packageName.replace(".", "\\.");
    assert.match(config, new RegExp(`from: node_modules/${escapedName}`));
    assert.match(config, new RegExp(`to: app/node_modules/${escapedName}`));
  }
});

test("electron-builder.yml is not missing any required updater runtime packages", () => {
  assert.deepEqual(missingFromBuilderConfig(config), []);
});

test("electron-updater runtime packages resolve from project node_modules", () => {
  assert.deepEqual(missingFromNodeModules(projectRoot), []);
});
