import test from "node:test";
import assert from "node:assert/strict";
import { getStartupFailureDisposition } from "./startup-failure.ts";

test("startup failure exits when ui is not ready", () => {
  assert.deepEqual(getStartupFailureDisposition({ uiReady: false, message: "boom" }), {
    shouldShowStartupPage: false,
    shouldQuit: true,
    message: "boom",
  });
});

test("startup failure stays on startup page when ui is ready", () => {
  assert.deepEqual(getStartupFailureDisposition({ uiReady: true, message: "boom" }), {
    shouldShowStartupPage: true,
    shouldQuit: false,
    message: "boom",
  });
});
