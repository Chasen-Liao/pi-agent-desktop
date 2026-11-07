import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  shouldFollowAgentSettle,
  shouldFollowStreamingUpdate,
} from "./chat-scroll-policy.ts";

const hookSource = readFileSync(new URL("./use-chat-scroll.ts", import.meta.url), "utf8");
const sessionHookSource = readFileSync(new URL("../useAgentSession.ts", import.meta.url), "utf8");

test("shouldFollowStreamingUpdate only scrolls when followStreaming, agentRunning, and isAtBottom are true", () => {
  assert.equal(
    shouldFollowStreamingUpdate({
      agentRunning: true,
      isAtBottom: true,
      followStreaming: true,
    }),
    true,
  );
  assert.equal(
    shouldFollowStreamingUpdate({
      agentRunning: true,
      isAtBottom: true,
      followStreaming: false,
    }),
    false,
  );
  assert.equal(
    shouldFollowStreamingUpdate({
      agentRunning: true,
      isAtBottom: false,
      followStreaming: true,
    }),
    false,
  );
  assert.equal(
    shouldFollowStreamingUpdate({
      agentRunning: false,
      isAtBottom: true,
      followStreaming: true,
    }),
    false,
  );
});

test("shouldFollowAgentSettle skips final smooth scroll when followStreaming is disabled", () => {
  assert.equal(
    shouldFollowAgentSettle({
      agentRunning: false,
      initialScrollDone: true,
      isAtBottom: true,
      followStreaming: true,
    }),
    true,
  );
  assert.equal(
    shouldFollowAgentSettle({
      agentRunning: false,
      initialScrollDone: true,
      isAtBottom: true,
      followStreaming: false,
    }),
    false,
  );
  assert.equal(
    shouldFollowAgentSettle({
      agentRunning: true,
      initialScrollDone: true,
      isAtBottom: true,
      followStreaming: true,
    }),
    false,
  );
  assert.equal(
    shouldFollowAgentSettle({
      agentRunning: false,
      initialScrollDone: false,
      isAtBottom: true,
      followStreaming: true,
    }),
    false,
  );
  assert.equal(
    shouldFollowAgentSettle({
      agentRunning: false,
      initialScrollDone: true,
      isAtBottom: false,
      followStreaming: true,
    }),
    false,
  );
});

test("useChatScroll wires shouldFollowStreamingUpdate and shouldFollowAgentSettle while keeping user send scroll unconditional", () => {
  assert.match(hookSource, /followStreaming = true/);
  assert.match(hookSource, /shouldFollowStreamingUpdate\(\{/);
  assert.match(hookSource, /shouldFollowAgentSettle\(\{/);
  assert.match(hookSource, /if \(pendingScrollToUserRef\.current\)/);
});

test("useAgentSession uses followStreaming prop as single source of truth", () => {
  assert.match(sessionHookSource, /followStreaming = true/);
  assert.doesNotMatch(sessionHookSource, /loadedFollowStreaming/);
});
