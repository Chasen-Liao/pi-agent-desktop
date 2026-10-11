import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeMermaidSource } from "../docs/wiki/sanitize-mermaid.mjs";

test("quotes parallelogram labels that contain [id] path params", () => {
  const source = [
    "graph TB",
    "    API_Agent[/api/agent/[id]/]",
    "    API_Sessions[/api/sessions/]",
  ].join("\n");
  const out = sanitizeMermaidSource(source);
  assert.match(out, /API_Agent\["\/api\/agent\/\[id\]\/"\]/);
  assert.match(out, /API_Sessions\[\/api\/sessions\/\]/);
});

test("quotes rectangle labels with nested brackets", () => {
  const out = sanitizeMermaidSource("    B -->|文件读写| G[/api/files/[...path]]");
  assert.match(out, /G\["\/api\/files\/\[\.\.\.path\]"\]/);
});

test("quotes sequence participant aliases that contain [id]", () => {
  const out = sanitizeMermaidSource("    participant API as POST /api/agent/[id]");
  assert.match(out, /participant API as "POST \/api\/agent\/\[id\]"/);
});
