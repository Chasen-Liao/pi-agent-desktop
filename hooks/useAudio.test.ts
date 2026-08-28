import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./useAudio.ts", import.meta.url), "utf8");

// P2: the deferred AudioContext close timer must be tracked so unmount can
// clear it and close the context (no dangling timer / leaked WebAudio context).
test("playDone schedules a tracked close timer", () => {
  // The deferred AudioContext close must be tracked in pendingAudioRef, and
  // the timer callback must clear the ref before closing the context.
  assert.match(source, /pendingAudioRef\.current = \{ timer, ctx \};/);
  assert.match(source, /if \(pendingAudioRef\.current\?\.ctx === ctx\) pendingAudioRef\.current = null;/);
  assert.match(source, /ctx\.close\(\)\.catch\(\(\) => \{\}\)/);
});

test("unmount cleanup clears the close timer and closes the context", () => {
  assert.match(source, /clearTimeout\(pending\.timer\);/);
  assert.match(source, /pending\.ctx\.close\(\)/);
});
