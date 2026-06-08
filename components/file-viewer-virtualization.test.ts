import test from "node:test";
import assert from "node:assert/strict";
import { getVirtualLineWindow } from "./file-viewer-virtualization.ts";

test("virtual line window renders a bounded first viewport when height is unknown", () => {
  const window = getVirtualLineWindow({
    lineCount: 10_000,
    scrollTop: 0,
    viewportHeight: 0,
    rowHeight: 21,
    overscanRows: 20,
  });

  assert.equal(window.startIndex, 0);
  assert.ok(window.endIndex > 0);
  assert.ok(window.endIndex < 10_000);
  assert.equal(window.topPaddingHeight, 0);
  assert.ok(window.bottomPaddingHeight > 0);
});

test("virtual line window clamps stale scroll offsets after content shrinks", () => {
  const window = getVirtualLineWindow({
    lineCount: 10,
    scrollTop: 20_000,
    viewportHeight: 420,
    rowHeight: 21,
    overscanRows: 20,
  });

  assert.equal(window.startIndex, 10);
  assert.equal(window.endIndex, 10);
  assert.equal(window.topPaddingHeight, 210);
  assert.equal(window.bottomPaddingHeight, 0);
});

