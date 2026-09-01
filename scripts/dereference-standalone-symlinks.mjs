/**
 * @electron/universal realpath()s every file and compares relative paths.
 * If standalone/node_modules still contains symlinks into the build-tree
 * node_modules, x64 and arm64 temp apps sit at different depths, so the same
 * target becomes two different relative paths and the merge aborts:
 *
 *   uniqueToX64:   ../../../../../../../../Users/runner/.../semver/bin/semver.js
 *   uniqueToArm64: ../../../node_modules/.../semver/bin/semver.js
 *
 * Materialize those links into real copies before electron-builder copies
 * extraResources into the .app.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function collectSymlinks(root, found = []) {
  if (!existsSync(root)) return found;
  for (const name of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, name.name);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      found.push(path);
      continue;
    }
    if (stat.isDirectory()) collectSymlinks(path, found);
  }
  return found;
}

export function dereferenceSymlinks(root) {
  const links = collectSymlinks(root).sort((a, b) => b.length - a.length);
  let replaced = 0;
  let removed = 0;
  for (const link of links) {
    let target;
    try {
      target = realpathSync(link);
    } catch {
      rmSync(link, { force: true });
      removed += 1;
      continue;
    }
    rmSync(link, { force: true, recursive: true });
    cpSync(target, link, { recursive: true, dereference: true });
    replaced += 1;
  }
  return { replaced, removed };
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const standalone = join(process.cwd(), ".next", "standalone");
  if (!existsSync(standalone)) {
    console.error("dereference-standalone-symlinks: .next/standalone not found");
    process.exit(1);
  }
  const { replaced, removed } = dereferenceSymlinks(standalone);
  console.log(
    `dereference-standalone-symlinks: replaced ${replaced}, removed ${removed} dangling`,
  );
}
