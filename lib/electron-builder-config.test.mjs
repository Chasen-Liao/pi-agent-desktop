import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { minimatch } from "minimatch";
import {
  missingFromBuilderConfig,
  missingFromNodeModules,
} from "./electron-updater-runtime-deps.mjs";

const config = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

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

test("Linux packaging emits a deb artifact", () => {
  assert.match(config, /linux:\n[\s\S]*?target: deb/);
  assert.match(config, /icon: build\/icon\.png/);
  assert.match(config, /category: Development/);
  assert.match(config, /executableName: pi-agent-desktop/);
  assert.match(config, /artifactName: "Pi-Agent-Desktop-\$\{version\}-linux-\$\{arch\}\.\$\{ext\}"/);
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
    "Contents/Resources/standalone/.next/node_modules/@earendil-works/pi-coding-agent-4cdde81112ef3dc5/node_modules/@mariozechner/clipboard-darwin-arm64/clipboard.darwin-arm64.node",
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
