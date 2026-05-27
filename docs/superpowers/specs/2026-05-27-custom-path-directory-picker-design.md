# Custom Path Directory Picker Design

**Goal:** Replace the manual `Custom path...` text entry with direct folder selection, using the native Windows folder picker in both Electron and local web mode.

## Scope

- Keep the existing CWD dropdown and recent/default directory behavior.
- Change only the `Custom path...` flow.
- On cancel, close the custom-path flow and keep the current CWD unchanged.
- Keep the implementation Windows-first, matching the current desktop product expectations.

## Approach

### Electron

- Add a new preload API: `window.electronAPI.selectDirectory()`.
- Implement it in `electron/main.ts` with `dialog.showOpenDialog({ properties: ["openDirectory"] })`.
- Return either the selected absolute folder path or `null` when cancelled.

### Web

- Add a small Next.js API route that runs only on the local Windows host and opens a native folder chooser through PowerShell.
- Return either the selected absolute folder path or `null` when cancelled.
- If the route fails, surface a small inline error in the sidebar instead of changing the selected CWD.

### Sidebar UI

- Remove the inline free-text path input for `Custom path...`.
- When the user clicks `Custom path...`, immediately start directory selection.
- If a path is returned, set it as `selectedCwd`, then close the dropdown.
- If selection is cancelled, close the dropdown and leave `selectedCwd` unchanged.

## Constraints

- Do not add a new test framework.
- Do not change unrelated session or explorer behavior.
- Do not rely on browser-only directory APIs that cannot provide a stable absolute CWD.

## Verification

- Add a small pure helper test for the selection result handling:
  - selected path updates CWD and closes the dropdown
  - cancelled selection keeps the old CWD and closes the dropdown
- Run the focused test first to observe failure, then implement the minimal code to pass.
- Run `node_modules/.bin/tsc --noEmit` after code changes.
