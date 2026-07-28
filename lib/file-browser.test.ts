import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DIR_LIST_LIMIT,
  filterDirEntryNames,
  finalizeDirListEntries,
  getAudioMime,
  getImageMime,
  getLanguage,
  parseByteRange,
  shouldIgnoreDirEntryName,
  sortDirListEntries,
} from "./file-browser.ts";

test("shouldIgnoreDirEntryName filters node_modules and .pyc", () => {
  assert.equal(shouldIgnoreDirEntryName("node_modules"), true);
  assert.equal(shouldIgnoreDirEntryName(".git"), true);
  assert.equal(shouldIgnoreDirEntryName("foo.pyc"), true);
  assert.equal(shouldIgnoreDirEntryName("src"), false);
  assert.equal(shouldIgnoreDirEntryName("index.ts"), false);
});

test("getLanguage special-cases Dockerfile and .env", () => {
  assert.equal(getLanguage("Dockerfile"), "dockerfile");
  assert.equal(getLanguage("Dockerfile.dev"), "dockerfile");
  assert.equal(getLanguage(".env"), "bash");
  assert.equal(getLanguage(".env.local"), "bash");
  assert.equal(getLanguage("Makefile"), "makefile");
  assert.equal(getLanguage("app.tsx"), "typescript");
});

test("getImageMime and getAudioMime map known extensions", () => {
  assert.equal(getImageMime("a.PNG"), "image/png");
  assert.equal(getImageMime("x.unknown"), null);
  assert.equal(getAudioMime("track.mp3"), "audio/mpeg");
  assert.equal(getAudioMime("x.nope"), null);
});

test("filterDirEntryNames truncates at limit", () => {
  const names = Array.from({ length: 50 }, (_, i) => `f${String(i).padStart(3, "0")}`);
  const { names: kept, truncated } = filterDirEntryNames(names, 10);
  assert.equal(truncated, true);
  assert.equal(kept.length, 10);
  assert.ok(!kept.includes("node_modules"));
});

test("filterDirEntryNames drops ignored before counting limit", () => {
  const names = ["node_modules", "a.ts", "b.ts"];
  const { names: kept, truncated } = filterDirEntryNames(names, 100);
  assert.deepEqual(kept.sort(), ["a.ts", "b.ts"]);
  assert.equal(truncated, false);
});

test("sortDirListEntries puts directories first", () => {
  const sorted = sortDirListEntries([
    { name: "z.ts", isDir: false, size: 1, modified: "t" },
    { name: "a-dir", isDir: true, size: 0, modified: "t" },
    { name: "b.ts", isDir: false, size: 1, modified: "t" },
  ]);
  assert.deepEqual(
    sorted.map((e) => e.name),
    ["a-dir", "b.ts", "z.ts"]
  );
});

test("finalizeDirListEntries can truncate after sort", () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({
    name: `f${i}`,
    isDir: false,
    size: 1,
    modified: "t",
  }));
  const { entries: out, truncated } = finalizeDirListEntries(entries, 2);
  assert.equal(truncated, true);
  assert.equal(out.length, 2);
});

test("DEFAULT_DIR_LIST_LIMIT is a sane positive cap", () => {
  assert.ok(DEFAULT_DIR_LIST_LIMIT >= 100);
  assert.ok(DEFAULT_DIR_LIST_LIMIT <= 10_000);
});

test("parseByteRange handles open-ended and suffix ranges", () => {
  assert.deepEqual(parseByteRange("bytes=0-9", 100), { ok: true, start: 0, end: 9 });
  assert.deepEqual(parseByteRange("bytes=10-", 100), { ok: true, start: 10, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-20", 100), { ok: true, start: 80, end: 99 });
  assert.equal(parseByteRange("items=1-2", 100).ok, false);
  assert.equal(parseByteRange("bytes=200-300", 100).ok, false);
});
