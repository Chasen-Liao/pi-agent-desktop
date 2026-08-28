import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { latestRequestStale } from "./use-session-loader.ts";

const source = readFileSync(new URL("./use-session-loader.ts", import.meta.url), "utf8");

test("latestRequestStale returns false while its request is the latest", () => {
  const ref = { current: 0 };
  const stale = latestRequestStale(ref);
  assert.equal(stale(), false);
});

test("latestRequestStale returns true once a newer request bumps the ref (M3)", () => {
  const ref = { current: 0 };
  const stale = latestRequestStale(ref);
  latestRequestStale(ref); // a newer call wins
  assert.equal(stale(), true);
  // and it keeps reporting stale as even newer calls arrive
  latestRequestStale(ref);
  assert.equal(stale(), true);
});

// Wiring: loadSession and loadContext must each install a stale guard so a
// slow response cannot overwrite newer state (M3).
test("loadSession/loadContext wire per-request stale guards", () => {
  assert.match(source, /const stale = latestRequestStale\(loadReqIdRef\)/);
  assert.match(source, /const stale = latestRequestStale\(loadContextReqIdRef\)/);
});
