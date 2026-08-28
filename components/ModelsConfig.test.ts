import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");

// P2: the "Saved" confirmation reset timer must live in a useEffect with a
// cleanup (the modal can close before the 2s reset fires), not as a bare
// setTimeout inside the save handler.
test("savedOk reset timer is scheduled in an effect with cleanup", () => {
  assert.match(source, /if \(!savedOk\) return;/);
  assert.match(source, /const t = setTimeout\(\(\) => setSavedOk\(false\), \d+\);/);
  assert.match(source, /return \(\) => clearTimeout\(t\);/);
  assert.doesNotMatch(source, /setSavedOk\(true\);\s*setTimeout/);
});
