import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  LARGE_SOURCE_BYTES,
  LARGE_SOURCE_LINES,
  shouldUseLargeSourceViewer,
} from "./file-viewer-large-source.ts";

const source = readFileSync(new URL("./FileViewer.tsx", import.meta.url), "utf8");

test("large source fallback triggers only past size/line limits in plain source view", () => {
  const base = { hasContent: true, viewMode: "source", previewMode: false, contentLength: 0, lineCount: 0 };
  assert.equal(shouldUseLargeSourceViewer(base), false);
  assert.equal(shouldUseLargeSourceViewer({ ...base, contentLength: LARGE_SOURCE_BYTES + 1 }), true);
  assert.equal(shouldUseLargeSourceViewer({ ...base, lineCount: LARGE_SOURCE_LINES + 1 }), true);
  // Exactly at the limits is still the normal (syntax highlighted) viewer.
  assert.equal(shouldUseLargeSourceViewer({ ...base, contentLength: LARGE_SOURCE_BYTES }), false);
  assert.equal(shouldUseLargeSourceViewer({ ...base, lineCount: LARGE_SOURCE_LINES }), false);
});

test("diff mode, markdown preview, and missing content never take the large source fallback", () => {
  const big = { hasContent: true, viewMode: "source", previewMode: false, contentLength: LARGE_SOURCE_BYTES + 1, lineCount: 0 };
  assert.equal(shouldUseLargeSourceViewer({ ...big, viewMode: "diff" }), false);
  assert.equal(shouldUseLargeSourceViewer({ ...big, previewMode: true }), false);
  assert.equal(shouldUseLargeSourceViewer({ ...big, hasContent: false }), false);
});

// Wiring (no render harness): the large-source branch must render the
// virtualization-aware plain-text viewer with the large-file notice.
test("large source branch renders the plain text viewer with the large-file notice", () => {
  assert.match(source, /isLargeSource \? \(/);
  assert.match(source, /<PlainTextViewer[^>]*showLargeFileNotice/);
});

// Invariant: the plain-text fallback must stay after the diff and markdown
// branches so rich views keep render priority.
test("diff and markdown branches precede the large source fallback", () => {
  const diffIndex = source.indexOf('viewMode === "diff" && hasDiff');
  const markdownIndex = source.indexOf("isMarkdown && previewMode");
  const largeSourceIndex = source.indexOf("isLargeSource ? (");
  assert.ok(diffIndex >= 0, "expected diff branch");
  assert.ok(markdownIndex >= 0, "expected markdown preview branch");
  assert.ok(largeSourceIndex >= 0, "expected large source branch");
  assert.ok(diffIndex < largeSourceIndex, "diff branch should stay before large source fallback");
  assert.ok(markdownIndex < largeSourceIndex, "markdown preview should stay before large source fallback");
});

test("media viewers translate load errors during rendering", () => {
  assert.doesNotMatch(source, /setError\(t\("file\.load(?:Image|Audio)Failed"\)\)/);
  assert.match(source, /loadFailed[\s\S]*t\("file\.loadImageFailed"\)/);
  assert.match(source, /loadFailed[\s\S]*t\("file\.loadAudioFailed"\)/);
});
