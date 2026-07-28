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

test("defaultDesktopSettings is ask + default tools", () => {
  const d = defaultDesktopSettings();
  assert.equal(d.defaultAgentMode, "ask");
  assert.equal(d.defaultToolPreset, "default");
});

test("mergeDesktopSettings ignores invalid fields", () => {
  const m = mergeDesktopSettings({
    defaultAgentMode: "nope",
    defaultToolPreset: "full",
  });
  assert.equal(m.defaultAgentMode, "ask");
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
