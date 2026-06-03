import test from "node:test";
import assert from "node:assert/strict";
import { choosePort } from "./port-selection.ts";

test("choosePort tries the requested number of sequential ports", async () => {
  const attempts: number[] = [];

  await assert.rejects(
    choosePort({
      startPort: 30141,
      maxAttempts: 3,
      reservePort: async (port) => {
        attempts.push(port);
        throw Object.assign(new Error("in use"), { code: "EADDRINUSE" });
      },
    }),
    /No free port found after 3 attempts/,
  );

  assert.deepEqual(attempts, [30141, 30142, 30143]);
});

test("choosePort continues after non-EADDRINUSE listen failures", async () => {
  const attempts: number[] = [];

  const port = await choosePort({
    startPort: 30141,
    maxAttempts: 3,
    reservePort: async (candidate) => {
      attempts.push(candidate);
      if (candidate < 30143) {
        throw new Error("listen failed");
      }
      return candidate;
    },
  });

  assert.equal(port, 30143);
  assert.deepEqual(attempts, [30141, 30142, 30143]);
});
