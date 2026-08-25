import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "./types.ts";
import { splitActiveThinking } from "./active-thinking.ts";

test("splitActiveThinking keeps non-assistant streams unchanged", () => {
  const message: Partial<AgentMessage> = { role: "user", content: "hello" };
  assert.deepEqual(splitActiveThinking(message), {
    activeThinking: "",
    visibleStreamingMessage: message,
  });
});

test("splitActiveThinking moves live reasoning into the persistent indicator", () => {
  const message = {
    role: "assistant" as const,
    content: [
      { type: "thinking" as const, thinking: "Inspecting the code" },
      { type: "thinking" as const, thinking: "Choosing a fix" },
      { type: "text" as const, text: "Done" },
    ],
    model: "test",
    provider: "test",
  };

  const result = splitActiveThinking(message);
  assert.equal(result.activeThinking, "Inspecting the code\n\nChoosing a fix");
  assert.deepEqual(result.visibleStreamingMessage?.content, [
    { type: "text", text: "Done" },
  ]);
});

test("splitActiveThinking suppresses an empty streaming message shell", () => {
  const message = {
    role: "assistant" as const,
    content: [{ type: "thinking" as const, thinking: "Still working" }],
    model: "test",
    provider: "test",
  };

  assert.deepEqual(splitActiveThinking(message), {
    activeThinking: "Still working",
    visibleStreamingMessage: null,
  });
});
