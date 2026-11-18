import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchWindowsInstaller } from "./update-windows-installer.ts";

test("an installer launch failure rejects before the app can quit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-update-"));
  try {
    await assert.rejects(launchWindowsInstaller(join(directory, "missing.exe")), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true });
  }
});
