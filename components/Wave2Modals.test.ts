import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mcpSource = readFileSync(join(process.cwd(), "components/McpConfigModal.tsx"), "utf8");
const exportSource = readFileSync(join(process.cwd(), "components/SessionExportModal.tsx"), "utf8");
const extSource = readFileSync(join(process.cwd(), "components/ExtensionsConfigModal.tsx"), "utf8");
const branchCloneSource = readFileSync(join(process.cwd(), "components/BranchCloneModal.tsx"), "utf8");

test("McpConfigModal exports McpConfigModal and McpConfigContent and tests connection via POST /api/mcp/test", () => {
  assert.match(mcpSource, /export function McpConfigModal/);
  assert.match(mcpSource, /export function McpConfigContent/);
  assert.match(mcpSource, /fetch\("\/api\/mcp\/test"/);
  assert.match(mcpSource, /fetch\("\/api\/mcp\/toggle"/);
  assert.match(mcpSource, /role="dialog"/);
  assert.match(mcpSource, /aria-modal="true"/);
});

test("SessionExportModal exports SessionExportModal and calls export API with download flag", () => {
  assert.match(exportSource, /export function SessionExportModal/);
  assert.match(exportSource, /\/api\/sessions\/.*\/export\?format=.*&download=true/);
  assert.match(exportSource, /role="dialog"/);
  assert.match(exportSource, /aria-modal="true"/);
});

test("ExtensionsConfigModal exports ExtensionsConfigModal and integrates McpConfigContent and extension/skill tabs", () => {
  assert.match(extSource, /export function ExtensionsConfigModal/);
  assert.match(extSource, /<McpConfigContent/);
  assert.match(extSource, /t\("mcp\.servers"\)/);
  assert.match(extSource, /t\("extension\.extensions"\)/);
  assert.match(extSource, /t\("extension\.skills"\)/);
  assert.match(extSource, /t\("extension\.diagnostics"\)/);
  assert.match(extSource, /fetch\("\/api\/extensions"/);
  assert.match(extSource, /role="dialog"/);
  assert.match(extSource, /aria-modal="true"/);
});

test("BranchCloneModal exports BranchCloneModal supporting branch and clone operations", () => {
  assert.match(branchCloneSource, /export function BranchCloneModal/);
  assert.match(branchCloneSource, /\/api\/sessions\/.*\/branch/);
  assert.match(branchCloneSource, /\/api\/sessions\/.*\/clone/);
  assert.match(branchCloneSource, /targetEntryId/);
  assert.match(branchCloneSource, /role="dialog"/);
  assert.match(branchCloneSource, /aria-modal="true"/);
});
