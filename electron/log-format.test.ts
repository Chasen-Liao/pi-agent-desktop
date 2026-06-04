import test from "node:test";
import assert from "node:assert/strict";
import { deriveScope, formatElectronLogLine } from "./log-format.ts";

test("formatElectronLogLine emits a single JSON line with stable fields", () => {
  const line = formatElectronLogLine({
    time: "2026-06-04T12:00:00.000Z",
    level: "info",
    source: "electron-main",
    scope: "autoUpdater",
    message: "autoUpdater checking-for-update",
    detail: { sessionId: "s1", requestId: "r1" },
  });

  assert.match(line, /\n$/);
  const parsed = JSON.parse(line) as Record<string, unknown>;
  assert.equal(parsed.time, "2026-06-04T12:00:00.000Z");
  assert.equal(parsed.level, "info");
  assert.equal(parsed.source, "electron-main");
  assert.equal(parsed.scope, "autoUpdater");
  assert.equal(parsed.message, "autoUpdater checking-for-update");
  assert.deepEqual(parsed.detail, { sessionId: "s1", requestId: "r1" });
});

test("formatElectronLogLine accepts any non-empty scope string", () => {
  const rendererLine = formatElectronLogLine({
    time: "2026-06-04T12:00:00.000Z",
    level: "info",
    source: "electron-renderer",
    scope: "useAgentSession",
    message: "navigate_tree cancelled",
  });
  const apiLine = formatElectronLogLine({
    time: "2026-06-04T12:00:00.000Z",
    level: "error",
    source: "next-api",
    scope: "api/sessions",
    message: "session load failed",
  });

  assert.equal(JSON.parse(rendererLine).scope, "useAgentSession");
  assert.equal(JSON.parse(apiLine).scope, "api/sessions");
});

test("formatElectronLogLine summarizes Error details without leaking environment objects", () => {
  const line = formatElectronLogLine({
    time: "2026-06-04T12:00:00.000Z",
    level: "error",
    source: "electron-main",
    scope: "autoUpdater",
    message: "autoUpdater error",
    detail: new Error("network failed"),
  });

  const parsed = JSON.parse(line) as { detail: { name: string; message: string; stack?: string } };
  assert.equal(parsed.detail.name, "Error");
  assert.equal(parsed.detail.message, "network failed");
  assert.equal(typeof parsed.detail.stack, "string");
});

test("formatElectronLogLine omits detail when undefined and uses caller-provided time", () => {
  const line = formatElectronLogLine({
    time: "2026-06-04T12:00:00.000Z",
    level: "info",
    source: "electron-renderer",
    scope: "useAgentSession",
    message: "navigate_tree cancelled",
  });

  const parsed = JSON.parse(line) as Record<string, unknown>;
  assert.equal(parsed.time, "2026-06-04T12:00:00.000Z");
  assert.equal("detail" in parsed, false);
});

test("formatElectronLogLine falls back to a fresh ISO time when time is omitted", () => {
  const before = Date.now();
  const line = formatElectronLogLine({
    level: "info",
    source: "electron-main",
    scope: "main",
    message: "boot",
  });
  const after = Date.now();

  const parsed = JSON.parse(line) as { time: string };
  const parsedMs = Date.parse(parsed.time);
  assert.ok(parsedMs >= before - 5 && parsedMs <= after + 5, `time ${parsed.time} not in window`);
});

test("deriveScope returns the first whitespace-delimited word", () => {
  assert.equal(deriveScope("autoUpdater update-available"), "autoUpdater");
  assert.equal(deriveScope("api/sessions load failed"), "api/sessions");
  assert.equal(deriveScope("  [Next] ready  "), "_Next_");
});

test("deriveScope falls back to 'main' for empty or whitespace-only messages", () => {
  assert.equal(deriveScope(""), "main");
  assert.equal(deriveScope("   "), "main");
  assert.equal(deriveScope("\n\t"), "main");
});
