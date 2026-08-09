import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./use-session-loader.ts", import.meta.url), "utf8");

// M3: loadSession must guard against stale responses overwriting state when
// sessions switch quickly (A→B). The `cancelled` flag in useAgentSession.ts
// only guards the outer `.then`; the loader's own setState calls need a
// latest-request-wins guard. This repo has no React rendering test harness
// (no jsdom / testing-library), so the guard is asserted structurally.
test("loadSession applies a latest-request-wins guard against stale responses (M3)", () => {
  assert.match(source, /loadReqIdRef/);
  assert.match(source, /reqId !== loadReqIdRef\.current/);
});

test("loadContext applies a latest-request-wins guard (M3 follow-up)", () => {
  assert.match(source, /loadContextReqIdRef/);
  assert.match(source, /reqId !== loadContextReqIdRef\.current/);
});
