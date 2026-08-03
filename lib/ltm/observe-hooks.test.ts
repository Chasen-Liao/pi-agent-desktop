import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  branchEntriesToMessagesText,
  contentToText,
  safeLtmPreCompactObserve,
} from "./observe-hooks.ts";
import {
  getMemoryService,
  resetMemoryServiceForTests,
} from "./service.ts";

test("contentToText handles string content", () => {
  assert.equal(contentToText("hello"), "hello");
});

test("contentToText joins text and thinking blocks", () => {
  const text = contentToText([
    { type: "text", text: "line1" },
    { type: "thinking", thinking: "think" },
    { type: "toolCall", toolName: "bash", input: {} },
    { type: "image", source: { type: "url", url: "x" } },
  ]);
  assert.equal(text, "line1\nthink");
});

test("contentToText returns empty for unknown shapes", () => {
  assert.equal(contentToText(null), "");
  assert.equal(contentToText(42), "");
  assert.equal(contentToText([{ type: "image" }]), "");
});

test("branchEntriesToMessagesText extracts user/assistant/toolResult only", () => {
  const entries = [
    { type: "session", id: "s" },
    {
      type: "message",
      message: { role: "user", content: "Fix the bug" },
    },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Looking into it" }],
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "t1",
        content: [{ type: "text", text: "file contents" }],
      },
    },
    {
      type: "message",
      message: { role: "custom", content: "skip me", display: true },
    },
    { type: "compaction", summary: "old summary" },
    {
      type: "message",
      message: { role: "user", content: "  " },
    },
  ];

  const text = branchEntriesToMessagesText(entries);
  assert.equal(
    text,
    "user: Fix the bug\n\nassistant: Looking into it\n\ntoolResult: file contents"
  );
});

test("branchEntriesToMessagesText empty branch is empty string", () => {
  assert.equal(branchEntriesToMessagesText([]), "");
  assert.equal(branchEntriesToMessagesText([{ type: "compaction" }]), "");
});

test("safeLtmPreCompactObserve no-ops when observePreCompact false", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "ltm-hooks-"));
  try {
    writeFileSync(
      join(agentDir, "desktop-settings.json"),
      JSON.stringify({
        ltm: {
          enabled: true,
          observePreCompact: false,
          dbPath: join(agentDir, "memory", "ltm.sqlite"),
        },
      })
    );
    resetMemoryServiceForTests();

    await safeLtmPreCompactObserve({
      sessionId: "sess-1",
      cwd: agentDir,
      messagesText: "should not persist",
      agentDir,
    });

    const service = getMemoryService(agentDir);
    assert.equal(service.getConfig().observePreCompact, false);
    const hits = await service.recallFromCwd(agentDir, {
      query: "should not persist",
      limit: 5,
      kinds: ["observation"],
    });
    assert.equal(hits.length, 0);
  } finally {
    resetMemoryServiceForTests();
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("safeLtmPreCompactObserve persists when enabled", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "ltm-hooks-on-"));
  try {
    writeFileSync(
      join(agentDir, "desktop-settings.json"),
      JSON.stringify({
        ltm: {
          enabled: true,
          observePreCompact: true,
          dbPath: join(agentDir, "memory", "ltm.sqlite"),
        },
      })
    );
    resetMemoryServiceForTests();

    await safeLtmPreCompactObserve({
      sessionId: "sess-compact-1",
      cwd: agentDir,
      messagesText: "user: remember this before compact\n\nassistant: ok",
      agentDir,
    });

    const service = getMemoryService(agentDir);
    const hits = await service.recallFromCwd(agentDir, {
      query: "remember this before compact",
      limit: 5,
      kinds: ["observation"],
    });
    assert.ok(hits.length >= 1, "expected at least one observation hit");
    assert.ok(
      hits.some(
        (h) =>
          h.kind === "observation" &&
          (h.snippet.includes("remember this") ||
            h.title.includes("remember this"))
      )
    );
  } finally {
    resetMemoryServiceForTests();
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("safeLtmPreCompactObserve swallows errors", async () => {
  await safeLtmPreCompactObserve({
    sessionId: "x",
    cwd: "\0invalid",
    messagesText: "anything",
  });
});
