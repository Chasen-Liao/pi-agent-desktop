import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./global-error.tsx", import.meta.url), "utf8");

// global-error is the last line of defense when the crash originates in the
// root layout or the i18n context provider itself: it must render without
// either of them or the window stays permanently blank (issue #20 follow-up).
test("global error boundary satisfies the Next.js global-error contract", () => {
  // Error boundaries must be Client Components.
  assert.match(source, /["']use client["']/);
  // global-error replaces the root layout, so it renders its own document.
  assert.match(source, /<html[\s>]/);
  assert.match(source, /<body[\s>]/);
  // Next 16 renamed the recover prop to retry; the recover button must call it.
  assert.match(source, /retry:\s*\(\)\s*=>\s*void/);
  assert.doesNotMatch(source, /\breset\b/);
  assert.match(source, /onClick=\{\(\)\s*=>\s*retry\(\)\}/);
  // No React context here (the provider lives inside the replaced layout);
  // word lookup must go through the context-free translate() helper.
  assert.doesNotMatch(source, /useI18n|I18nProvider/);
  assert.match(source, /translate\(/);
});
