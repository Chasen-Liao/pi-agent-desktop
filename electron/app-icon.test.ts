import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { getAppIconPath } from "./app-icon.ts";

test("getAppIconPath selects the native macOS icon", () => {
  assert.equal(getAppIconPath("/Applications/Pi.app", "darwin"), path.join("/Applications/Pi.app", "build", "icon.icns"));
});

test("getAppIconPath keeps the Windows icon for non-macOS packages", () => {
  assert.equal(getAppIconPath("C:\\Pi", "win32"), path.join("C:\\Pi", "build", "icon.ico"));
});
