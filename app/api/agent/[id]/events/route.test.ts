import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("agent events route uses the shared JSON error contract", () => {
  assert.match(source, /import \{ errorMessage, getRequestId, jsonError, logApiError \}/);
  assert.match(source, /return jsonError\(req, 404, ["']Session not found["']/);
  assert.match(source, /errorCode: ["']SESSION_NOT_FOUND["']/);
  assert.match(source, /return jsonError\(req, 500, errorMessage\(error\)/);
  assert.match(source, /errorCode: ["']AGENT_EVENTS_INIT_FAILED["']/);
  assert.match(source, /return jsonError\(req, 500, `Failed to start agent:/);
  assert.match(source, /errorCode: ["']AGENT_START_FAILED["']/);
});
