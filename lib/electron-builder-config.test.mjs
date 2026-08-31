import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { minimatch } from "minimatch";
import {
  ELECTRON_UPDATER_RUNTIME_PACKAGES,
  missingFromBuilderConfig,
  missingFromNodeModules,
} from "./electron-updater-runtime-deps.mjs";

const config = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
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

function standaloneExtraResourcesBlock(source) {
  const start = source.indexOf("- from: .next/standalone\n");
  const end = source.indexOf("- from: .next/standalone/node_modules");
  assert.ok(start !== -1, "standalone extraResources entry expected");
  assert.ok(end !== -1 && end > start, "standalone/node_modules entry expected after standalone entry");
  return source.slice(start, end);
}

test("standalone extraResources filter excludes test files from the installer", () => {
  const block = standaloneExtraResourcesBlock(config);
  for (const pattern of [
    "!**/*.test.ts",
    "!**/*.test.tsx",
    "!**/*.test.mjs",
    "!**/*.test.js",
  ]) {
    assert.ok(
      block.includes(`- "${pattern}"`),
      `standalone filter must contain ${pattern}`
    );
  }
});

test("macOS packaging emits universal DMG and ZIP artifacts", () => {
  assert.match(config, /mac:\n[\s\S]*?target: dmg[\s\S]*?- universal/);
  assert.match(config, /mac:\n[\s\S]*?target: zip[\s\S]*?- universal/);
  assert.match(config, /icon: build\/icon\.icns/);
  assert.match(config, /category: public\.app-category\.developer-tools/);
  assert.match(config, /artifactName: "Pi-Agent-Desktop-\$\{version\}-mac-\$\{arch\}\.\$\{ext\}"/);
  assert.doesNotMatch(
    config,
    /^electronDist:/m,
    "a host-only electronDist prevents universal packaging from downloading both architectures",
  );
});

test("Universal merge skips lipo only for architecture-specific runtime paths", () => {
  const match = config.match(/^\s*x64ArchFiles: "([^"]+)"$/m);
  assert.ok(match, "mac.x64ArchFiles pattern expected");
  const pattern = match[1];
  for (const path of [
    "Contents/Resources/standalone/node_modules/@earendil-works/pi-tui/native/darwin/prebuilds/darwin-arm64/darwin-modifiers.node",
    "Contents/Resources/standalone/node_modules/@earendil-works/pi-tui/native/darwin/prebuilds/darwin-x64/darwin-modifiers.node",
    "Contents/Resources/standalone/node_modules/@img/sharp-darwin-arm64/lib/sharp.node",
    "Contents/Resources/standalone/node_modules/@img/sharp-darwin-x64/lib/sharp.node",
    "Contents/Resources/standalone/node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips.dylib",
    "Contents/Resources/standalone/node_modules/@img/sharp-libvips-darwin-x64/lib/libvips.dylib",
  ]) {
    assert.ok(minimatch(path, pattern), `${path} must match x64ArchFiles`);
  }
  assert.equal(
    minimatch(
      "Contents/MacOS/Pi Agent Desktop",
      pattern,
    ),
    false,
    "the Electron executable must still be merged with lipo",
  );
});
