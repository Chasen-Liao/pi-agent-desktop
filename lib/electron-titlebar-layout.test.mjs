import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preloadSource = readFileSync(new URL("../electron/preload.ts", import.meta.url), "utf8");
const titleSource = readFileSync(
  new URL("../components/session-sidebar/PiAgentTitle.tsx", import.meta.url),
  "utf8",
);
const headerSource = readFileSync(
  new URL("../components/session-sidebar/SidebarHeader.tsx", import.meta.url),
  "utf8",
);
const appShellSource = readFileSync(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("macOS Electron title bar keeps sidebar controls clear of the traffic lights", () => {
  assert.match(preloadSource, /dataset\.electronPlatform\s*=\s*process\.platform/);
  assert.match(titleSource, /pi-agent-title/);
  assert.match(headerSource, /sidebar-title-row/);
  assert.match(globalStyles, /\.sidebar-new-session-button\s*\{[^}]*margin-left:\s*auto/s);
  assert.match(
    globalStyles,
    /html\[data-electron-platform="darwin"\]\s+\.sidebar-title-row\s+\.pi-agent-title\s*\{[^}]*display:\s*none/s,
  );
});

test("sidebar title bar actions use the compact toolbar scale", () => {
  assert.match(globalStyles, /\.sidebar-new-session-button\s*\{[^}]*min-height:\s*28px/s);
  assert.match(globalStyles, /\.sidebar-new-session-button\s*\{[^}]*font-size:\s*11px/s);
  assert.match(globalStyles, /\.sidebar-icon-button\s*\{[^}]*width:\s*26px;\s*height:\s*26px/s);
  assert.match(headerSource, /className="sidebar-icon-button sidebar-refresh-button"/);
});

test("collapsed macOS sidebar reserves the traffic-light area in the main toolbar", () => {
  assert.match(appShellSource, /macos-titlebar-leading-safe-area/);
  assert.match(appShellSource, /sidebarOpen\s*\?\s*""\s*:\s*" is-active"/);
  assert.match(
    globalStyles,
    /html\[data-electron-platform="darwin"\]\s+\.macos-titlebar-leading-safe-area\.is-active\s*\{[^}]*width:\s*80px/s,
  );
  assert.match(
    globalStyles,
    /\.macos-titlebar-leading-safe-area\s*\{[^}]*transition:\s*width var\(--duration-fast\) var\(--ease-smooth-out\)/s,
  );
});

test("workbench menu escapes the clipped chat column", () => {
  assert.match(appShellSource, /const \[shellMenuPosition, setShellMenuPosition\]/);
  assert.match(appShellSource, /shellMenuButtonRef\.current[^]*getBoundingClientRect\(\)/);
  assert.match(
    appShellSource,
    /id="workbench-menu"[^]*className="[^"]*fixed z-\[700\][^"]*"[^]*style=\{shellMenuPosition\}/,
  );
  assert.doesNotMatch(
    appShellSource,
    /id="workbench-menu"[^]*className="[^"]*absolute[^"]*"/,
  );
});
