import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  collectSymlinks,
  dereferenceSymlinks,
} from "./dereference-standalone-symlinks.mjs";

function withTempTree(fn) {
  const dir = mkdtempSync(join(tmpdir(), "deref-standalone-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("materializes a file symlink that points outside the tree", () => {
  withTempTree((dir) => {
    const outside = join(dir, "outside.js");
    writeFileSync(outside, "module.exports = 1;\n");
    const nested = join(dir, "standalone", "node_modules", "semver", "bin");
    mkdirSync(nested, { recursive: true });
    const link = join(nested, "semver.js");
    try {
      symlinkSync(outside, link);
    } catch (error) {
      if (error && (error.code === "EPERM" || error.code === "EACCES")) {
        return;
      }
      throw error;
    }
    assert.equal(collectSymlinks(join(dir, "standalone")).length, 1);
    const { replaced, removed } = dereferenceSymlinks(join(dir, "standalone"));
    assert.equal(replaced, 1);
    assert.equal(removed, 0);
    assert.equal(collectSymlinks(join(dir, "standalone")).length, 0);
    assert.equal(readFileSync(link, "utf8"), "module.exports = 1;\n");
  });
});

test("drops dangling symlinks", () => {
  withTempTree((dir) => {
    const nested = join(dir, "standalone", "node_modules");
    mkdirSync(nested, { recursive: true });
    const link = join(nested, "missing");
    try {
      symlinkSync(join(dir, "does-not-exist"), link);
    } catch (error) {
      if (error && (error.code === "EPERM" || error.code === "EACCES")) {
        return;
      }
      throw error;
    }
    const { replaced, removed } = dereferenceSymlinks(join(dir, "standalone"));
    assert.equal(replaced, 0);
    assert.equal(removed, 1);
    assert.equal(collectSymlinks(join(dir, "standalone")).length, 0);
  });
});
