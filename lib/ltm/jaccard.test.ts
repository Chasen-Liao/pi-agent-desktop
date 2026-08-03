import test from "node:test";
import assert from "node:assert/strict";
import { jaccardSimilarity } from "./jaccard.ts";

test("identical multi-word strings score 1", () => {
  assert.equal(jaccardSimilarity("prefer dark mode theme", "prefer dark mode theme"), 1);
});

test("disjoint strings score 0", () => {
  assert.equal(jaccardSimilarity("alpha beta gamma", "delta epsilon zeta"), 0);
});

test("high overlap exceeds 0.7", () => {
  const s = jaccardSimilarity(
    "use path resolve for session root directory layout",
    "use path resolve for session root directory layout please"
  );
  assert.ok(s > 0.7);
});
