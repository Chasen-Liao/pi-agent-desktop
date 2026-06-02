import test from "node:test";
import assert from "node:assert/strict";
import { rewriteChildHeader } from "./session-cascade.ts";

const sampleChild = (parent: string | undefined) => ({
  type: "session",
  version: 3,
  id: "child-uuid",
  timestamp: "2026-06-01T00:00:00Z",
  cwd: "/tmp/test",
  ...(parent !== undefined ? { parentSession: parent } : {}),
});

const format = (header: object) =>
  JSON.stringify(header) + "\n" +
  JSON.stringify({ type: "message", id: "m1", parentId: null, message: { role: "user", content: "hi" } }) + "\n";

test("rewrites child when parentSession matches oldParent", () => {
  const oldParent = "/sessions/parent.jsonl";
  const newParent = "/sessions/grandparent.jsonl";
  const content = format(sampleChild(oldParent));
  const { newContent, changed } = rewriteChildHeader(content, oldParent, newParent);
  assert.equal(changed, true);
  const newHeader = JSON.parse(newContent.split("\n")[0]);
  assert.equal(newHeader.parentSession, newParent);
  assert.equal(newHeader.id, "child-uuid");
});

test("leaves child unchanged when parentSession is different", () => {
  const content = format(sampleChild("/sessions/other.jsonl"));
  const { newContent, changed } = rewriteChildHeader(
    content,
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, false);
  assert.equal(newContent, content);
});

test("leaves child unchanged when header is malformed JSON", () => {
  const content = "not json at all\n" + JSON.stringify({ type: "message" });
  const { newContent, changed } = rewriteChildHeader(
    content,
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, false);
  assert.equal(newContent, content);
});

test("leaves child unchanged when type is not 'session'", () => {
  const content = JSON.stringify({ type: "message", id: "m1" }) + "\n";
  const { newContent, changed } = rewriteChildHeader(
    content,
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, false);
  assert.equal(newContent, content);
});

test("leaves child unchanged when header is valid JSON null", () => {
  const content = "null\n" + JSON.stringify({ type: "message", id: "m1" });
  const { newContent, changed } = rewriteChildHeader(
    content,
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, false);
  assert.equal(newContent, content);
});

test("leaves child unchanged when header is a JSON array", () => {
  const content = "[1, 2, 3]\n";
  const { newContent, changed } = rewriteChildHeader(
    content,
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, false);
  assert.equal(newContent, content);
});

test("removes parentSession when newParent is null", () => {
  const oldParent = "/sessions/parent.jsonl";
  const content = format(sampleChild(oldParent));
  const { newContent, changed } = rewriteChildHeader(content, oldParent, null);
  assert.equal(changed, true);
  const newHeader = JSON.parse(newContent.split("\n")[0]);
  assert.equal("parentSession" in newHeader, false);
  assert.equal(newHeader.id, "child-uuid");
});

test("preserves all other header fields", () => {
  const header = {
    type: "session",
    version: 3,
    id: "child-uuid",
    timestamp: "2026-06-01T00:00:00Z",
    cwd: "/tmp/test",
    customField: "preserved",
    nested: { a: 1, b: 2 },
    parentSession: "/sessions/parent.jsonl",
  };
  const content = JSON.stringify(header) + "\n";
  const { newContent, changed } = rewriteChildHeader(
    content,
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, true);
  const newHeader = JSON.parse(newContent.split("\n")[0]);
  assert.equal(newHeader.customField, "preserved");
  assert.deepEqual(newHeader.nested, { a: 1, b: 2 });
});

test("preserves rest of file content beyond first line", () => {
  const line1 = JSON.stringify(sampleChild("/sessions/parent.jsonl"));
  const line2 = JSON.stringify({ type: "message", id: "m1", parentId: null, message: { role: "user", content: "hi" } });
  const line3 = JSON.stringify({ type: "message", id: "m2", parentId: "m1", message: { role: "assistant", content: [] } });
  const content = line1 + "\n" + line2 + "\n" + line3 + "\n";
  const { newContent, changed } = rewriteChildHeader(
    content,
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, true);
  const lines = newContent.split("\n");
  assert.equal(JSON.parse(lines[0]).parentSession, "/sessions/grandparent.jsonl");
  assert.equal(lines[1], line2);
  assert.equal(lines[2], line3);
  assert.equal(lines[3], "");
});

test("handles empty content", () => {
  const { newContent, changed } = rewriteChildHeader(
    "",
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, false);
  assert.equal(newContent, "");
});

test("handles content without trailing newline", () => {
  const line1 = JSON.stringify(sampleChild("/sessions/parent.jsonl"));
  const line2 = JSON.stringify({ type: "message", id: "m1" });
  const content = line1 + "\n" + line2;
  const { newContent, changed } = rewriteChildHeader(
    content,
    "/sessions/parent.jsonl",
    "/sessions/grandparent.jsonl",
  );
  assert.equal(changed, true);
  const lines = newContent.split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).parentSession, "/sessions/grandparent.jsonl");
  assert.equal(lines[1], line2);
});
