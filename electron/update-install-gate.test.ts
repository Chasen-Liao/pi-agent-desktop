import test from "node:test";
import assert from "node:assert/strict";
import {
  createUpdateInstallState,
  markUpdateDownloaded,
  canQuitAndInstall,
  decideQuitAndInstall,
  createUpdateStatusPayload,
  transitionUpdateStatus,
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

test("transitionUpdateStatus tracks checking, available, downloading, and downloaded lifecycle", () => {
  let status = createUpdateStatusPayload("0.12.0");
  assert.equal(status.status, "idle");
  assert.equal(status.currentVersion, "0.12.0");

  status = transitionUpdateStatus(status, { type: "checking", now: 1000 });
  assert.equal(status.status, "checking");
  assert.equal(status.checkedAt, 1000);

  status = transitionUpdateStatus(status, { type: "available", version: "0.13.0", now: 2000 });
  assert.equal(status.status, "available");
  assert.equal(status.availableVersion, "0.13.0");

  status = transitionUpdateStatus(status, {
    type: "downloading",
    percent: 42.5,
    transferred: 425,
    total: 1000,
  });
  assert.equal(status.status, "downloading");
  assert.equal(status.percent, 42.5);

  status = transitionUpdateStatus(status, { type: "downloaded", version: "0.13.0", now: 3000 });
  assert.equal(status.status, "downloaded");
  assert.equal(status.downloadedVersion, "0.13.0");
  assert.equal(status.percent, 100);
});

test("transitionUpdateStatus handles not-available, error, and unsupported states", () => {
  let status = createUpdateStatusPayload("0.12.0");
  status = transitionUpdateStatus(status, { type: "not-available", now: 100 });
  assert.equal(status.status, "not-available");
  assert.equal(status.availableVersion, null);

  status = transitionUpdateStatus(status, { type: "error", message: "network timeout", now: 200 });
  assert.equal(status.status, "error");
  assert.equal(status.error, "network timeout");

  status = transitionUpdateStatus(status, { type: "unsupported", now: 300 });
  assert.equal(status.status, "unsupported");
  assert.equal(status.error, null);
});

