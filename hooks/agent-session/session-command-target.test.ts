import assert from "node:assert/strict";
import test from "node:test";

import { resolveSessionCommandTarget } from "./session-command-target.ts";

test("a created session id wins over stale new-session render state", () => {
  assert.deepEqual(
    resolveSessionCommandTarget({
      sessionId: "real-session-id",
      isNew: true,
      newSessionCwd: "D:\\workspace",
    }),
    { kind: "existing", sessionId: "real-session-id" }
  );
});

test("a session is created only before the server has assigned an id", () => {
  assert.deepEqual(
    resolveSessionCommandTarget({
      sessionId: null,
      isNew: true,
      newSessionCwd: "D:\\workspace",
    }),
    { kind: "new", cwd: "D:\\workspace" }
  );
});
