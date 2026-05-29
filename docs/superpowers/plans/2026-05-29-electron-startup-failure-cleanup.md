# Electron Startup Failure Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure Electron startup failures always clean up the spawned Next.js process, and exit after showing an error when failure happens before the window/tray UI is established.

**Architecture:** Keep the existing startup-page flow for failures that happen after the app window exists. Add one small startup-phase decision in `electron/main.ts` so early failures exit cleanly, while later failures stay visible in the startup page. Cover the behavior with a focused Node test around small exported helpers instead of trying to boot Electron in tests.

**Tech Stack:** Electron, TypeScript, Node built-in test runner

---

### Task 1: Add a small tested startup-failure decision helper

**Files:**
- Create: `electron/startup-failure.ts`
- Create: `electron/startup-failure.test.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { getStartupFailureDisposition } from "./startup-failure.ts";

test("startup failure exits when ui is not ready", () => {
  assert.deepEqual(
    getStartupFailureDisposition({ uiReady: false, message: "boom" }),
    { shouldShowStartupPage: false, shouldQuit: true, message: "boom" }
  );
});

test("startup failure stays on startup page when ui is ready", () => {
  assert.deepEqual(
    getStartupFailureDisposition({ uiReady: true, message: "boom" }),
    { shouldShowStartupPage: true, shouldQuit: false, message: "boom" }
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test electron/startup-failure.test.ts`
Expected: FAIL with module-not-found or missing-export error for `getStartupFailureDisposition`

- [ ] **Step 3: Write minimal implementation**

```ts
export function getStartupFailureDisposition({
  uiReady,
  message,
}: {
  uiReady: boolean;
  message: string;
}) {
  return {
    shouldShowStartupPage: uiReady,
    shouldQuit: !uiReady,
    message,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test electron/startup-failure.test.ts`
Expected: PASS

### Task 2: Apply the helper in the startup catch path and always clean up child process

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Track whether startup UI is ready**

```ts
let startupUiReady = false;
```

Set it after both `createWindow()` and `createTray(mainWindow!)` succeed.

- [ ] **Step 2: Always clean up before handling startup failure**

```ts
cleanup();
const disposition = getStartupFailureDisposition({
  uiReady: startupUiReady,
  message: errorMessage,
});
```

- [ ] **Step 3: Preserve startup page only when UI exists**

```ts
if (disposition.shouldShowStartupPage) {
  serverState = "stopped";
  showStartupState("error", disposition.message);
  return;
}

dialog.showErrorBox("Failed to start Pi Agent Desktop", disposition.message);
app.quit();
```

- [ ] **Step 4: Reset startup UI state on window close path if needed**

```ts
mainWindow.on("closed", () => {
  startupUiReady = false;
  mainWindow = null;
});
```

### Task 3: Verify the fix

**Files:**
- No new files

- [ ] **Step 1: Run the focused startup test**

Run: `node --test electron/main.test.ts`
Expected: PASS

- [ ] **Step 2: Run the existing focused regression test**

Run: `node --test lib/custom-path-selection.test.ts`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Manual desktop verification**

Run: `npm run dev:electron`
Expected: normal startup still reaches the app UI; when a startup failure is injected before UI initialization the app shows an error box then exits; when failure happens after UI initialization the startup page remains visible with an error message
