import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./MessageView.tsx", import.meta.url), "utf8");

// P2: every one-shot "Copied" reset timer must live inside a useEffect with a
// cleanup (so it never calls setState after unmount), never as a bare
// setTimeout in a copy handler.
test("copied-state reset timers are scheduled in effects with cleanup", () => {
  const timers = source.match(/setTimeout\(\(\) => setCopied\(false\), \d+\)/g);
  assert.equal(timers?.length ?? 0, 3, "three copied resets (user, assistant, code)");
  const cleanups = source.match(/return \(\) => clearTimeout\(t\);/g);
  assert.ok(cleanups && cleanups.length >= 3, "each copied timer must have an effect cleanup");
  // No copy handler may set copied true and then start a bare timer:
  assert.doesNotMatch(source, /setCopied\(true\);\s*setTimeout/);
});
