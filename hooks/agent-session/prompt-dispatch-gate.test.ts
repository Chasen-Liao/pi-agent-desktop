import assert from "node:assert/strict";
import test from "node:test";

import {
  finishPromptDispatch,
  tryStartPromptDispatch,
  type PromptDispatchState,
} from "./prompt-dispatch-gate.ts";

test("a prompt dispatch gate rejects rapid re-entry until released", () => {
  const state: PromptDispatchState = { current: false };

  assert.equal(tryStartPromptDispatch(state), true);
  assert.equal(tryStartPromptDispatch(state), false);

  finishPromptDispatch(state);
  assert.equal(tryStartPromptDispatch(state), true);
});
