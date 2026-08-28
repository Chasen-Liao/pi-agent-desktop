import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./error.tsx", import.meta.url), "utf8");

// Issue #20: this boundary is the last line of defense against whole-tree
// unmount (blank window). If it stops satisfying the Next.js error.tsx
// contract, rendering errors go back to a permanently blank screen.
test("error boundary satisfies the Next.js error.tsx contract", () => {
  // Error boundaries must be Client Components.
  assert.match(source, /["']use client["']/);
  // Next 16 renamed the reset prop to retry; the reload button must call it.
  assert.match(source, /retry:\s*\(\)\s*=>\s*void/);
  assert.doesNotMatch(source, /\breset\b/);
  assert.match(source, /onClick=\{\(\)\s*=>\s*retry\(\)\}/);
});
