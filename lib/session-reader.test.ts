import test from "node:test";
import assert from "node:assert/strict";
import { buildSessionContext } from "./session-reader.ts";
import type { SessionEntry } from "./types.ts";

test("context edits retain provenance for Fork and omit removed contributions", () => {
  const entries: SessionEntry[] = [
    { type: "message", id: "first", parentId: null, timestamp: "2026-09-30", message: { role: "user", content: "first" } },
    { type: "message", id: "second", parentId: "first", timestamp: "2026-09-30", message: { role: "user", content: "second" } },
    { type: "context_edit", id: "omit", parentId: "second", timestamp: "2026-09-30", targetId: "first", replacement: null },
    { type: "context_edit", id: "replace", parentId: "omit", timestamp: "2026-09-30", targetId: "second", replacement: { content: "replacement" } },
  ];
  const result = buildSessionContext(entries);
  assert.deepEqual(result.messages.map((message) => message.content), ["replacement"]);
  assert.deepEqual(result.entryIds, ["second"]);
  assert.deepEqual(buildSessionContext(entries, "second").entryIds, ["first", "second"]);
  assert.deepEqual(buildSessionContext(entries, null).messages, []);
});
