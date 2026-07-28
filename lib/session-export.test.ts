import test from "node:test";
import assert from "node:assert/strict";
import { formatEntriesToMarkdown, exportSessionToHtml } from "./session-export.ts";
import type { SessionEntry } from "./types.ts";

test("formatEntriesToMarkdown returns empty string for empty entries", () => {
  const result = formatEntriesToMarkdown([]);
  assert.equal(result, "");
});

test("formatEntriesToMarkdown formats user messages correctly", () => {
  const entries: SessionEntry[] = [
    {
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: "2026-07-28T00:00:00Z",
      message: {
        role: "user",
        content: "Hello, pi!",
      },
    },
    {
      type: "message",
      id: "m2",
      parentId: "m1",
      timestamp: "2026-07-28T00:01:00Z",
      message: {
        role: "user",
        content: [
          { type: "text", text: "Line 1" },
          { type: "image", source: { type: "base64", data: "..." } },
          { type: "text", text: "Line 2" },
        ],
      },
    },
  ];

  const markdown = formatEntriesToMarkdown(entries);
  assert.ok(markdown.includes("## User"));
  assert.ok(markdown.includes("Hello, pi!"));
  assert.ok(markdown.includes("Line 1\n[Image]\nLine 2"));
});

test("formatEntriesToMarkdown formats assistant messages with text, thinking, and tool calls", () => {
  const entries: SessionEntry[] = [
    {
      type: "message",
      id: "m3",
      parentId: null,
      timestamp: "2026-07-28T00:02:00Z",
      message: {
        role: "assistant",
        model: "test-model",
        provider: "test-provider",
        content: [
          { type: "thinking", thinking: "Analyzing user input..." },
          { type: "text", text: "I will use bash tool." },
          {
            type: "toolCall",
            toolCallId: "tc-1",
            toolName: "bash",
            input: { command: "echo hello" },
          },
        ],
      },
    },
  ];

  const markdown = formatEntriesToMarkdown(entries);
  assert.ok(markdown.includes("## Assistant"));
  assert.ok(markdown.includes("> *Thinking:*\n> Analyzing user input..."));
  assert.ok(markdown.includes("I will use bash tool."));
  assert.ok(markdown.includes("### Tool Call: `bash`"));
  assert.ok(markdown.includes('"command": "echo hello"'));
});

test("formatEntriesToMarkdown formats tool results and errors", () => {
  const entries: SessionEntry[] = [
    {
      type: "message",
      id: "m4",
      parentId: "m3",
      timestamp: "2026-07-28T00:03:00Z",
      message: {
        role: "toolResult",
        toolCallId: "tc-1",
        toolName: "bash",
        content: [{ type: "text", text: "hello" }],
        isError: false,
      },
    },
    {
      type: "message",
      id: "m5",
      parentId: "m4",
      timestamp: "2026-07-28T00:04:00Z",
      message: {
        role: "toolResult",
        toolCallId: "tc-2",
        toolName: "read",
        content: [{ type: "text", text: "File not found" }],
        isError: true,
      },
    },
  ];

  const markdown = formatEntriesToMarkdown(entries);
  assert.ok(markdown.includes("### Tool Result: `bash`"));
  assert.ok(markdown.includes("```\nhello\n```"));
  assert.ok(markdown.includes("### Tool Result: `read` (Error)"));
  assert.ok(markdown.includes("File not found"));
});

test("formatEntriesToMarkdown formats compaction and custom entries", () => {
  const entries: SessionEntry[] = [
    {
      type: "compaction",
      id: "c1",
      parentId: null,
      timestamp: "2026-07-28T00:05:00Z",
      summary: "Compacted history",
      firstKeptEntryId: "m1",
      tokensBefore: 1000,
    },
  ];

  const markdown = formatEntriesToMarkdown(entries);
  assert.equal(markdown, "> *Session compacted: Compacted history*");
});

test("exportSessionToHtml throws ENOENT for non-existent file path", async () => {
  await assert.rejects(
    async () => {
      await exportSessionToHtml("non-existent-session-path.jsonl");
    },
    (err: Error) => {
      assert.ok(err.message.includes("non-existent-session-path.jsonl") || err.message.includes("ENOENT"));
      return true;
    }
  );
});
