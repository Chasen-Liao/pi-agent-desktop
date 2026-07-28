import test from "node:test";
import assert from "node:assert/strict";
import {
  createUpdateInstallState,
  markUpdateDownloaded,
  canQuitAndInstall,
  decideQuitAndInstall,
} from "./update-install-gate.ts";

test("quitAndInstall is refused before download", () => {
  const state = createUpdateInstallState();
  assert.equal(canQuitAndInstall(state), false);
  assert.deepEqual(decideQuitAndInstall(state), {
    allowed: false,
    reason: "No update has been downloaded",
  });
});

test("quitAndInstall is allowed after markUpdateDownloaded", () => {
  let state = createUpdateInstallState();
  state = markUpdateDownloaded(state, "1.2.3");
  assert.equal(canQuitAndInstall(state), true);
  assert.deepEqual(decideQuitAndInstall(state), {
    allowed: true,
    version: "1.2.3",
  });
});
