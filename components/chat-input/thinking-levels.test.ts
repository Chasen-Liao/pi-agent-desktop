import assert from "node:assert/strict";
import test from "node:test";
import { getThinkingLevelsForModel } from "./thinking-levels.ts";

test("includes max when the model reports max as a supported thinking level", () => {
  assert.deepEqual(getThinkingLevelsForModel(["off", "high", "max"]), [
    "auto",
    "off",
    "high",
    "max",
  ]);
});
