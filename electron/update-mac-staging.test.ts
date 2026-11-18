import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { stageMacUpdate } from "./update-mac-staging.ts";

test("macOS staging removes listeners after failure and allows a single retry", async () => {
  class NativeUpdater extends EventEmitter {
    checks = 0;
    checkForUpdates() { this.checks++; }
  }
  const updater = new NativeUpdater();
  // The real native updater also has electron-updater's permanent listeners.
  updater.on("error", () => {});
  const first = stageMacUpdate(updater);
  updater.emit("error", new Error("staging failed"));
  await assert.rejects(first, /staging failed/);
  assert.equal(updater.listenerCount("update-downloaded"), 0);
  assert.equal(updater.listenerCount("error"), 1);
  const retry = stageMacUpdate(updater);
  updater.emit("update-downloaded");
  await retry;
  assert.equal(updater.checks, 2);
  assert.equal(updater.listenerCount("update-downloaded"), 0);
  assert.equal(updater.listenerCount("error"), 1);
});

test("macOS staging treats an unavailable update as a retryable failure", async () => {
  const updater = Object.assign(new EventEmitter(), { checkForUpdates() {} });
  const attempt = stageMacUpdate(updater);
  updater.emit("update-not-available");
  await assert.rejects(attempt, /no update to stage/);
  assert.equal(updater.listenerCount("update-downloaded"), 0);
  assert.equal(updater.listenerCount("update-not-available"), 0);
  assert.equal(updater.listenerCount("error"), 0);
});
