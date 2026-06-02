import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "../../lib/types.ts";
import { calculateSessionStats } from "./session-stats.ts";

test("returns null when there are no usage values", () => {
  const messages: AgentMessage[] = [
    { role: "user", content: "hello" },
    {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      model: "claude",
      provider: "anthropic",
    },
  ];

  assert.equal(calculateSessionStats(messages), null);
});

test("sums assistant usage and cost", () => {
  const messages: AgentMessage[] = [
    { role: "user", content: "hello" },
    {
      role: "assistant",
      content: [{ type: "text", text: "first" }],
      model: "claude",
      provider: "anthropic",
      usage: {
        input: 10,
        output: 20,
        cacheRead: 30,
        cacheWrite: 40,
        cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
      },
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "second" }],
      model: "claude",
      provider: "anthropic",
      usage: {
        input: 1,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
        cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
      },
    },
  ];

  assert.deepEqual(calculateSessionStats(messages), {
    tokens: { input: 11, output: 22, cacheRead: 33, cacheWrite: 44 },
    cost: 11,
  });
});
