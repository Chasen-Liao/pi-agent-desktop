import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  defaultDesktopSettings,
  mergeDesktopSettings,
  readDesktopSettings,
  validateDesktopSettingsBody,
  writeDesktopSettings,
} from "./desktop-settings.ts";

test("defaultDesktopSettings is full + default tools", () => {
  const d = defaultDesktopSettings();
  assert.equal(d.defaultAgentMode, "full");
  assert.equal(d.defaultToolPreset, "default");
});

test("mergeDesktopSettings ignores invalid fields", () => {
  const m = mergeDesktopSettings({
    defaultAgentMode: "nope",
    defaultToolPreset: "full",
  });
  assert.equal(m.defaultAgentMode, "full");
  assert.equal(m.defaultToolPreset, "full");
});

test("read/write round-trip on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-desktop-settings-"));
  try {
    const written = writeDesktopSettings(dir, {
      defaultAgentMode: "plan",
      defaultToolPreset: "full",
    });
    assert.equal(written.defaultAgentMode, "plan");
    const read = readDesktopSettings(dir);
    assert.deepEqual(read, written);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readDesktopSettings missing file returns defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-desktop-settings-empty-"));
  try {
    assert.deepEqual(readDesktopSettings(dir), defaultDesktopSettings());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateDesktopSettingsBody", () => {
  assert.equal(validateDesktopSettingsBody({ defaultAgentMode: "ask" }), null);
  assert.match(validateDesktopSettingsBody(null)!, /object/);
  assert.match(validateDesktopSettingsBody({ defaultAgentMode: "x" })!, /defaultAgentMode/);
});

test("mergeDesktopSettings merges nested ltm and ignores invalid backend", () => {
  const m = mergeDesktopSettings({
    defaultAgentMode: "full",
    ltm: {
      enabled: false,
      backend: "nope",
      observeAgentEnd: false,
      agentmemoryUrl: "http://localhost:9999",
    },
  });
  assert.equal(m.defaultAgentMode, "full");
  assert.deepEqual(m.ltm, {
    enabled: false,
    observeAgentEnd: false,
    agentmemoryUrl: "http://localhost:9999",
  });
});

test("read/write round-trip preserves nested ltm", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-desktop-settings-ltm-"));
  try {
    const written = writeDesktopSettings(dir, {
      defaultAgentMode: "ask",
      defaultToolPreset: "default",
      ltm: { enabled: false, backend: "sqlite", dbPath: "C:/tmp/ltm.sqlite" },
    });
    assert.equal(written.ltm?.enabled, false);
    assert.equal(written.ltm?.backend, "sqlite");
    const read = readDesktopSettings(dir);
    assert.deepEqual(read.ltm, written.ltm);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateDesktopSettingsBody rejects invalid ltm.backend", () => {
  assert.match(
    validateDesktopSettingsBody({ ltm: { backend: "redis" } })!,
    /ltm\.backend/
  );
  assert.equal(validateDesktopSettingsBody({ ltm: { enabled: true } }), null);
});
