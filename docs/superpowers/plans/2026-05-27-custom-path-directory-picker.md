# Custom Path Directory Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual custom-path entry with native folder selection in Electron and local web mode, while keeping cancel behavior non-destructive.

**Architecture:** The sidebar will call a single directory-selection flow. Electron will use a preload-exposed IPC method backed by `dialog.showOpenDialog`, while web mode will call a small Windows-only API route that opens a native folder dialog via PowerShell. A pure helper will centralize how a selected or cancelled result updates sidebar state.

**Tech Stack:** Next.js App Router, React 19, Electron, TypeScript, Node built-in test runner, PowerShell

---

### Task 1: Add a small tested helper for custom-path selection results

**Files:**
- Create: `lib/custom-path-selection.ts`
- Create: `lib/custom-path-selection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { resolveCustomPathSelection } from "./custom-path-selection";

test("selected path updates cwd and closes the picker", () => {
  assert.deepEqual(
    resolveCustomPathSelection("C:\\old", "  C:\\work  "),
    { nextCwd: "C:\\work", shouldClose: true }
  );
});

test("cancelled selection keeps cwd and closes the picker", () => {
  assert.deepEqual(
    resolveCustomPathSelection("C:\\old", null),
    { nextCwd: "C:\\old", shouldClose: true }
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types lib/custom-path-selection.test.ts`
Expected: FAIL with module-not-found or missing-export error for `resolveCustomPathSelection`

- [ ] **Step 3: Write minimal implementation**

```ts
export function resolveCustomPathSelection(currentCwd: string | null, selectedPath: string | null) {
  const trimmed = selectedPath?.trim();
  return {
    nextCwd: trimmed ? trimmed : currentCwd,
    shouldClose: true,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types lib/custom-path-selection.test.ts`
Expected: PASS

### Task 2: Add directory-picking backends for Electron and web

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Create: `app/api/select-directory/route.ts`

- [ ] **Step 1: Add Electron IPC for folder selection**

```ts
ipcMain.handle("select-directory", async () => {
  const targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
  const result = await dialog.showOpenDialog(targetWindow, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});
```

- [ ] **Step 2: Expose preload bridge**

```ts
selectDirectory: () => ipcRenderer.invoke("select-directory"),
```

- [ ] **Step 3: Add web API route**

```ts
export async function POST() {
  const selectedPath = await selectDirectoryOnWindows();
  return NextResponse.json({ path: selectedPath });
}
```

- [ ] **Step 4: Implement Windows folder dialog execution**

```ts
const script = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$dialog.ShowNewFolderButton = $false",
  "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
  "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "  Write-Output $dialog.SelectedPath",
  "}",
].join("; ");
```

- [ ] **Step 5: Return `null` on cancel and fail clearly on unsupported hosts**

```ts
if (process.platform !== "win32") {
  return NextResponse.json({ error: "Directory picker is only supported on Windows." }, { status: 400 });
}
```

### Task 3: Replace the inline custom-path input with direct directory selection

**Files:**
- Modify: `components/SessionSidebar.tsx`

- [ ] **Step 1: Add a platform-aware directory selection function**

```ts
async function pickDirectory(): Promise<string | null> {
  if (window.electronAPI?.selectDirectory) {
    return window.electronAPI.selectDirectory();
  }

  const res = await fetch("/api/select-directory", { method: "POST" });
  const data = await res.json() as { path?: string | null; error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.path ?? null;
}
```

- [ ] **Step 2: Replace the custom-path click handler**

```ts
const handleCustomPath = useCallback(async () => {
  setCustomPathOpen(true);
  setError(null);
  try {
    const selectedPath = await pickDirectory();
    const { nextCwd, shouldClose } = resolveCustomPathSelection(selectedCwd, selectedPath);
    if (nextCwd !== selectedCwd) setSelectedCwd(nextCwd);
    if (shouldClose) {
      setCustomPathOpen(false);
      setDropdownOpen(false);
    }
  } catch (e) {
    setCustomPathOpen(false);
    setDropdownOpen(false);
    setError(String(e));
  }
}, [selectedCwd]);
```

- [ ] **Step 3: Remove the inline text input UI**

```tsx
<button onClick={(e) => { e.stopPropagation(); void handleCustomPath(); }}>
  <span>Custom path…</span>
</button>
```

### Task 4: Verify the change

**Files:**
- No new files

- [ ] **Step 1: Run the focused helper test**

Run: `node --test --experimental-strip-types lib/custom-path-selection.test.ts`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Optional manual check in desktop or local browser**

Run: `npm run dev:electron` or `npm run dev`
Expected: clicking `Custom path...` opens a Windows folder picker; cancel closes the flow; choosing a folder updates the active CWD
