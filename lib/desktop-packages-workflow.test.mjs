import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(
  join(root, ".github/workflows/desktop-packages.yml"),
  "utf8",
).replace(/\r\n/g, "\n");

test("desktop package workflow builds three hosts on v* tags", () => {
  assert.match(workflow, /^name: Desktop packages/m);
  assert.match(workflow, /tags:\n\s+- "v\*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /runner: windows-latest/);
  assert.match(workflow, /runner: ubuntu-latest/);
  assert.match(workflow, /runner: macos-latest/);
  assert.match(workflow, /dist_script: dist\n/);
  assert.match(workflow, /dist_script: dist:mac/);
  assert.match(workflow, /npm run \$\{\{ matrix\.dist_script \}\}/);
  assert.doesNotMatch(workflow, /npm run release/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.match(workflow, /sudo apt-get install -y fakeroot dpkg/);
});

test("desktop package workflow uploads GitHub Release assets only on tags", () => {
  assert.match(workflow, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /permissions:\n\s+contents: write/);
  assert.match(workflow, /latest-linux\.yml/);
  assert.match(workflow, /latest-mac\.yml/);
  assert.match(workflow, /mac-universal\.dmg/);
  assert.doesNotMatch(workflow, /electron-builder --publish always/);
});
