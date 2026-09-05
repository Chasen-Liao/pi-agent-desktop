import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mcpSource = readFileSync(join(process.cwd(), "components/McpConfigModal.tsx"), "utf8");
const exportSource = readFileSync(join(process.cwd(), "components/SessionExportModal.tsx"), "utf8");
const extSource = readFileSync(join(process.cwd(), "components/ExtensionsConfigModal.tsx"), "utf8");
const branchCloneSource = readFileSync(join(process.cwd(), "components/BranchCloneModal.tsx"), "utf8");
const modalSurfaceSource = readFileSync(join(process.cwd(), "components/ModalSurface.tsx"), "utf8");

test("McpConfigContent tests connection via POST /api/mcp/test", () => {
  assert.match(mcpSource, /export function McpConfigContent/);
  assert.match(mcpSource, /fetch\("\/api\/mcp\/test"/);
  assert.match(mcpSource, /apiJson\("\/api\/mcp\/toggle"/);
});

test("SessionExportModal exports SessionExportModal and calls export API with download flag", () => {
  assert.match(exportSource, /export function SessionExportModal/);
  assert.match(exportSource, /\/api\/sessions\/.*\/export\?format=.*&download=true/);
  assert.match(exportSource, /<ModalSurface/);
  assert.match(exportSource, /backdropClassName="ui-dialog-backdrop fixed inset-0 z-\[1000\] flex items-center justify-center p-4"/);
});

test("ExtensionsConfigModal exports ExtensionsConfigModal and integrates McpConfigContent and extension/skill tabs", () => {
  assert.match(extSource, /export function ExtensionsConfigModal/);
  assert.match(extSource, /<McpConfigContent/);
  assert.match(extSource, /t\("mcp\.servers"\)/);
  assert.match(extSource, /t\("extension\.extensions"\)/);
  assert.match(extSource, /t\("extension\.skills"\)/);
  assert.match(extSource, /t\("extension\.diagnostics"\)/);
  assert.match(extSource, /apiJson\(\s*["']\/api\/extensions["']/);
  assert.match(extSource, /<ModalSurface/);
  assert.match(extSource, /panelClassName="t-modal is-open ui-dialog-surface w-full max-w-4xl h-\[82vh\] max-h-\[750px\] rounded-\[14px\] flex flex-col overflow-hidden"/);
});

test("BranchCloneModal exports BranchCloneModal supporting branch and clone operations", () => {
  assert.match(branchCloneSource, /export function BranchCloneModal/);
  assert.match(branchCloneSource, /\/api\/sessions\/.*\/branch/);
  assert.match(branchCloneSource, /\/api\/sessions\/.*\/clone/);
  assert.match(branchCloneSource, /targetEntryId/);
  assert.match(branchCloneSource, /<ModalSurface/);
  assert.match(branchCloneSource, /panelClassName="t-modal is-open ui-dialog-surface w-full max-w-md rounded-\[14px\] flex flex-col overflow-hidden"/);
});

test("ModalSurface provides the shared dialog semantics", () => {
  assert.match(modalSurfaceSource, /role="dialog"/);
  assert.match(modalSurfaceSource, /aria-modal="true"/);
  assert.match(modalSurfaceSource, /aria-labelledby=\{ariaLabelledBy\}/);
});
