import assert from "node:assert/strict";
import test from "node:test";
import { streamReducer, initialStreamingState } from "./stream-state.ts";

test("start marks streaming without a message", () => {
  assert.deepEqual(streamReducer(initialStreamingState, { type: "start" }), {
    isStreaming: true,
    streamingMessage: null,
  });
});

test("update stores partial streaming message", () => {
  const message = { role: "assistant" as const };
  assert.deepEqual(streamReducer(initialStreamingState, { type: "update", message }), {
    isStreaming: true,
    streamingMessage: message,
  });
});

test("end clears streaming state", () => {
  const state = { isStreaming: true, streamingMessage: { role: "assistant" as const } };
  assert.deepEqual(streamReducer(state, { type: "end" }), initialStreamingState);
});

test("reset clears streaming state", () => {
  const state = { isStreaming: true, streamingMessage: { role: "assistant" as const } };
  assert.deepEqual(streamReducer(state, { type: "reset" }), initialStreamingState);
});
