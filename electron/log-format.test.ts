import test from "node:test";
import assert from "node:assert/strict";
import { formatElectronLogLine } from "./log-format.ts";

test("formatElectronLogLine emits a single JSON line with stable fields", () => {
  const line = formatElectronLogLine({
    time: "2026-06-04T12:00:00.000Z",
    level: "info",
    source: "electron-main",
    message: "autoUpdater checking-for-update",
    detail: { sessionId: "s1", requestId: "r1" },
  });

  assert.match(line, /\n$/);
  const parsed = JSON.parse(line) as Record<string, unknown>;
  assert.equal(parsed.time, "2026-06-04T12:00:00.000Z");
  assert.equal(parsed.level, "info");
  assert.equal(parsed.source, "electron-main");
  assert.equal(parsed.message, "autoUpdater checking-for-update");
  assert.deepEqual(parsed.detail, { sessionId: "s1", requestId: "r1" });
});

test("formatElectronLogLine summarizes Error details without leaking environment objects", () => {
  const line = formatElectronLogLine({
    time: "2026-06-04T12:00:00.000Z",
    level: "error",
    source: "electron-main",
    message: "autoUpdater error",
    detail: new Error("network failed"),
  });

  const parsed = JSON.parse(line) as { detail: { name: string; message: string; stack?: string } };
  assert.equal(parsed.detail.name, "Error");
  assert.equal(parsed.detail.message, "network failed");
  assert.equal(typeof parsed.detail.stack, "string");
});
