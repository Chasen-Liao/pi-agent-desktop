#!/usr/bin/env node
/**
 * Copy the current zread wiki into docs/wiki/content/ so GitHub Pages
 * (which only publishes /docs) can serve the architecture wiki.
 *
 * Usage
 *   node scripts/sync-github-pages-wiki.mjs
 *   node scripts/sync-github-pages-wiki.mjs --check
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const WIKI_ROOT_REL = join(".zread", "wiki");
export const PAGES_CONTENT_REL = join("docs", "wiki", "content");

/**
 * @param {string} projectRoot
 * @returns {{ versionId: string, sourceDir: string, destDir: string, files: string[] }}
 */
export function planWikiPagesSync(projectRoot) {
  const pointer = readFileSync(join(projectRoot, WIKI_ROOT_REL, "current"), "utf8").trim();
  const sourceDir = join(projectRoot, WIKI_ROOT_REL, pointer);
  const manifestPath = join(sourceDir, "wiki.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`wiki.json missing at ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const files = ["wiki.json", ...manifest.pages.map((page) => page.file)];
  for (const file of files) {
    const path = join(sourceDir, file);
    if (!existsSync(path)) {
      throw new Error(`wiki page missing: ${file}`);
    }
  }
  return {
    versionId: manifest.id ?? pointer.replace(/^versions[/\\]/, ""),
    sourceDir,
    destDir: join(projectRoot, PAGES_CONTENT_REL),
    files,
  };
}

/**
 * @param {string} projectRoot
 * @returns {{ copied: number, destDir: string, versionId: string }}
 */
export function syncWikiPages(projectRoot) {
  const plan = planWikiPagesSync(projectRoot);
  rmSync(plan.destDir, { recursive: true, force: true });
  mkdirSync(plan.destDir, { recursive: true });
  for (const file of plan.files) {
    cpSync(join(plan.sourceDir, file), join(plan.destDir, file));
  }
  writeFileSync(join(plan.destDir, "VERSION"), `${plan.versionId}\n`);
  return { copied: plan.files.length, destDir: plan.destDir, versionId: plan.versionId };
}

/**
 * @param {string} projectRoot
 */
export function assertWikiPagesInSync(projectRoot) {
  const plan = planWikiPagesSync(projectRoot);
  if (!existsSync(plan.destDir)) {
    throw new Error(`docs wiki content missing: ${plan.destDir}`);
  }
  for (const file of plan.files) {
    const src = readFileSync(join(plan.sourceDir, file), "utf8");
    const destPath = join(plan.destDir, file);
    if (!existsSync(destPath)) {
      throw new Error(`docs wiki missing ${file}`);
    }
    const dest = readFileSync(destPath, "utf8");
    if (src !== dest) {
      throw new Error(`docs wiki stale: ${file}`);
    }
  }
  const extra = readdirSync(plan.destDir).filter((name) => name !== "VERSION" && !plan.files.includes(name));
  if (extra.length) {
    throw new Error(`docs wiki extra files: ${extra.join(", ")}`);
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  if (process.argv.includes("--check")) {
    assertWikiPagesInSync(root);
    console.log("OK: docs/wiki/content matches current zread wiki");
  } else {
    const result = syncWikiPages(root);
    console.log(`Copied ${result.copied} wiki files → ${PAGES_CONTENT_REL} (${result.versionId})`);
  }
}
