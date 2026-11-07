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

test("defaultDesktopSettings is full + default tools + tray close + follow streaming", () => {
  const d = defaultDesktopSettings();
  assert.equal(d.defaultAgentMode, "full");
  assert.equal(d.defaultToolPreset, "default");
  assert.equal(d.closeAction, "tray");
  assert.equal(d.followStreaming, true);
});

test("mergeDesktopSettings ignores invalid fields", () => {
  const m = mergeDesktopSettings({
    defaultAgentMode: "nope",
    defaultToolPreset: "full",
    closeAction: "invalid",
    followStreaming: "nope",
  });
  assert.equal(m.defaultAgentMode, "full");
  assert.equal(m.defaultToolPreset, "full");
  assert.equal(m.closeAction, "tray");
  assert.equal(m.followStreaming, true);
});

test("read/write round-trip on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-desktop-settings-"));
  try {
    const written = writeDesktopSettings(dir, {
      defaultAgentMode: "plan",
      defaultToolPreset: "full",
      closeAction: "quit",
      followStreaming: false,
    });
    assert.equal(written.defaultAgentMode, "plan");
    assert.equal(written.closeAction, "quit");
    assert.equal(written.followStreaming, false);
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
  assert.match(validateDesktopSettingsBody({ codemodeEnabled: "yes" })!, /codemodeEnabled/);
  assert.equal(validateDesktopSettingsBody({ codemodeEnabled: true }), null);
  assert.match(validateDesktopSettingsBody({ closeAction: "minimize" })!, /closeAction/);
  assert.equal(validateDesktopSettingsBody({ closeAction: "tray" }), null);
  assert.equal(validateDesktopSettingsBody({ closeAction: "quit" }), null);
  assert.match(validateDesktopSettingsBody({ followStreaming: "no" })!, /followStreaming/);
  assert.equal(validateDesktopSettingsBody({ followStreaming: false }), null);
});

test("Codemode defaults off and persists alongside other desktop preferences", () => {
  assert.equal(defaultDesktopSettings().codemodeEnabled, false);
  const dir = mkdtempSync(join(tmpdir(), "pi-desktop-codemode-"));
  try {
    const saved = writeDesktopSettings(dir, { defaultAgentMode: "ask", defaultToolPreset: "full", codemodeEnabled: true, ltm: { enabled: false } });
    assert.deepEqual(readDesktopSettings(dir), saved);
    assert.equal(saved.codemodeEnabled, true);
    assert.equal(saved.ltm?.enabled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mergeDesktopSettings merges nested ltm", () => {
  const m = mergeDesktopSettings({
    defaultAgentMode: "full",
    ltm: {
      enabled: false,
      observeAgentEnd: false,
    },
  });
  assert.equal(m.defaultAgentMode, "full");
  assert.deepEqual(m.ltm, {
    enabled: false,
    observeAgentEnd: false,
  });
});

test("read/write round-trip preserves nested ltm", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-desktop-settings-ltm-"));
  try {
    const written = writeDesktopSettings(dir, {
      defaultAgentMode: "ask",
      defaultToolPreset: "default",
      ltm: { enabled: false, dbPath: "C:/tmp/ltm.sqlite" },
    });
    assert.equal(written.ltm?.enabled, false);
    const read = readDesktopSettings(dir);
    assert.deepEqual(read.ltm, written.ltm);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
