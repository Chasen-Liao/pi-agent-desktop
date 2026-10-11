import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertWikiPagesInSync, syncWikiPages } from "./sync-github-pages-wiki.mjs";

function withTempTree(fn) {
  const dir = mkdtempSync(join(tmpdir(), "wiki-pages-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedWiki(root) {
  const source = join(root, ".zread", "wiki", "versions", "2026-10-06-001245");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(root, ".zread", "wiki", "current"), "versions/2026-10-06-001245\n");
  writeFileSync(
    join(source, "wiki.json"),
    JSON.stringify({
      id: "2026-10-06-001245",
      pages: [{ slug: "1-xiang-mu-gai-lan", title: "项目概览", file: "1-xiang-mu-gai-lan.md" }],
    }),
  );
  writeFileSync(join(source, "1-xiang-mu-gai-lan.md"), "# 概览\n");
}

test("syncWikiPages copies the current wiki version into docs/wiki/content", () => {
  withTempTree((root) => {
    seedWiki(root);
    const result = syncWikiPages(root);
    assert.equal(result.copied, 2);
    assert.equal(result.versionId, "2026-10-06-001245");
    assert.equal(readFileSync(join(root, "docs", "wiki", "content", "1-xiang-mu-gai-lan.md"), "utf8"), "# 概览\n");
    assert.equal(readFileSync(join(root, "docs", "wiki", "content", "VERSION"), "utf8"), "2026-10-06-001245\n");
    assertWikiPagesInSync(root);
  });
});

test("assertWikiPagesInSync fails when a copied page is stale", () => {
  withTempTree((root) => {
    seedWiki(root);
    syncWikiPages(root);
    writeFileSync(join(root, "docs", "wiki", "content", "1-xiang-mu-gai-lan.md"), "# stale\n");
    assert.throws(() => assertWikiPagesInSync(root), /stale/);
  });
});
