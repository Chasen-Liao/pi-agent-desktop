import assert from "node:assert/strict";
import test from "node:test";

import type { AgentMessage, UserMessage } from "../../lib/types.ts";
import {
  reconcileOrAppendPendingUserMessage,
  reconcilePendingUserMessage,
} from "./user-message-reconciliation.ts";

test("canonical prompt event replaces its optimistic bubble instead of duplicating it", () => {
  const optimistic: UserMessage = {
    role: "user",
    content: "Ingest / Compile",
    timestamp: 100,
    clientMessageId: "client-1",
    deliveryState: "pending",
  };
  const canonical: UserMessage = {
    role: "user",
    content: "Ingest / Compile",
    timestamp: 200,
  };

  assert.deepEqual(
    reconcilePendingUserMessage([optimistic] satisfies AgentMessage[], canonical, "client-1"),
    {
      reconciled: true,
      messages: [{ ...canonical, timestamp: 100 }],
    }
  );
});

test("an unrelated user event remains available for normal append handling", () => {
  const optimistic: UserMessage = {
    role: "user",
    content: "first prompt",
    timestamp: 100,
    clientMessageId: "client-1",
    deliveryState: "pending",
  };
  const canonical: UserMessage = {
    role: "user",
    content: "different prompt",
    timestamp: 200,
  };

  assert.deepEqual(
    reconcilePendingUserMessage([optimistic] satisfies AgentMessage[], canonical, "missing-client"),
    { reconciled: false, messages: [optimistic] }
  );
});

test("a stale pending id falls back to appending the canonical event", () => {
  const existing: UserMessage = { role: "user", content: "earlier", timestamp: 100 };
  const canonical: UserMessage = { role: "user", content: "new prompt", timestamp: 200 };

  assert.deepEqual(
    reconcileOrAppendPendingUserMessage([existing], canonical, "stale-client"),
    [existing, canonical]
  );
});
