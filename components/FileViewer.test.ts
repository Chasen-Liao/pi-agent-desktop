import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./FileViewer.tsx", import.meta.url), "utf8");

test("large source files render with the plain text viewer notice", () => {
  assert.match(
    source,
    /isLargeSource \? \([\s\S]*<PlainTextViewer content=\{content\} wrapLines=\{wrapLines\} showLargeFileNotice \/>/
  );
});

test("source mode derives large-file detection from memoized lines", () => {
  assert.match(source, /const lines = useMemo\(\(\) => content\.split\("\\n"\), \[content\]\);/);
  assert.match(
    source,
    /const isLargeSource = useMemo\([\s\S]*\(\) => Boolean\([\s\S]*data[\s\S]*&& viewMode === "source"[\s\S]*&& !previewMode[\s\S]*&& \(content\.length > LARGE_SOURCE_BYTES \|\| lines\.length > LARGE_SOURCE_LINES\)/
  );
});

test("plain text viewer virtualizes large file rows", () => {
  assert.match(source, /const VIRTUAL_ROW_HEIGHT = \d+;/);
  assert.match(source, /const visibleLines = useMemo\(/);
  assert.match(source, /topPaddingHeight/);
  assert.match(source, /const shouldVirtualize = showLargeFileNotice && !wrapLines;/);
  assert.match(source, /getVirtualLineWindow\(\{/);
  assert.match(source, /viewportHeight,/);
  assert.doesNotMatch(source, /\{lines\.map\(\(line, index\) => \(/);
});

test("markdown preview and diff branches remain ahead of large source fallback", () => {
  const diffIndex = source.indexOf('viewMode === "diff" && hasDiff');
  const markdownIndex = source.indexOf('isMarkdown && previewMode');
  const largeSourceIndex = source.indexOf('isLargeSource ? (');

  assert.ok(diffIndex >= 0, "expected diff branch");
  assert.ok(markdownIndex >= 0, "expected markdown preview branch");
  assert.ok(largeSourceIndex >= 0, "expected large source branch");
  assert.ok(diffIndex < largeSourceIndex, "diff branch should stay before large source fallback");
  assert.ok(markdownIndex < largeSourceIndex, "markdown preview should stay before large source fallback");
});
