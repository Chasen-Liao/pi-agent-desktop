import test from "node:test";
import assert from "node:assert/strict";
import { projectIdFromCwd } from "./project-id.ts";

test("projectIdFromCwd is stable for same absolute path", () => {
  const a = projectIdFromCwd(process.cwd());
  const b = projectIdFromCwd(process.cwd());
  assert.equal(a, b);
  assert.match(a, /^proj_[0-9a-f]{16}$/);
});

test("projectIdFromCwd rejects empty cwd", () => {
  assert.throws(() => projectIdFromCwd("   "), /cwd/i);
});
