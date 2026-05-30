import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "./route.ts";

test("health route returns ok", async () => {
  const response = GET();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
