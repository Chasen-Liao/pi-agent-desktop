import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./useAudio.ts", import.meta.url), "utf8");

// P2: the deferred AudioContext close timer must be tracked so unmount can
// clear it and close the context (no dangling timer / leaked WebAudio context).
test("playDone schedules a tracked close timer", () => {
  assert.match(source, /const timer = setTimeout\(\(\) => \{\s*\n\s*ctx\.close\(\)\.catch\(\(\) => \{\}\);/);
  assert.match(source, /pendingAudioRef\.current = \{ timer, ctx \};/);
});

test("unmount cleanup clears the close timer and closes the context", () => {
  assert.match(source, /clearTimeout\(pending\.timer\);/);
  assert.match(source, /pending\.ctx\.close\(\)\.catch\(\(\) => \{\}\)/);
});
