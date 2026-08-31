import assert from "node:assert/strict";
import test from "node:test";
import { applyTitleBarOverlayTheme } from "./title-bar-overlay.ts";

test("applyTitleBarOverlayTheme ignores runtimes without overlay support", () => {
  assert.equal(applyTitleBarOverlayTheme(null, true), false);
  assert.equal(applyTitleBarOverlayTheme({}, false), false);
});

test("applyTitleBarOverlayTheme applies dark and light window colors", () => {
  const calls: Array<{ color: string; symbolColor: string }> = [];
  const target = {
    setTitleBarOverlay(options: { color: string; symbolColor: string }) {
      calls.push(options);
    },
  };

  assert.equal(applyTitleBarOverlayTheme(target, true), true);
  assert.equal(applyTitleBarOverlayTheme(target, false), true);
  assert.deepEqual(calls, [
    { color: "#0c1118", symbolColor: "#d9deea" },
    { color: "#ffffff", symbolColor: "#364152" },
  ]);
});
