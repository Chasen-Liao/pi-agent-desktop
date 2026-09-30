import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { exportSessionToHtml } from "./session-export.ts";

test("HTML export resolves the installed native Pi exporter for files and sessions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-export-native-"));
  try {
    const input = join(dir, "session.jsonl");
    const entries = [
      { type: "session", version: 3, id: "export-fixture", timestamp: new Date().toISOString(), cwd: dir },
      { type: "message", id: "message-fixture", parentId: null, timestamp: new Date().toISOString(), message: { role: "user", content: "export-fixture-message", timestamp: Date.now() } },
    ];
    writeFileSync(input, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
    for (const source of [input, SessionManager.open(input)]) {
      const output = join(dir, typeof source === "string" ? "file.html" : "session.html");
      assert.equal(await exportSessionToHtml(source, { outputPath: output }), output);
      const html = readFileSync(output, "utf8");
      assert.match(html, /<!DOCTYPE html>/i);
      const embedded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/);
      assert.ok(embedded, "native HTML must include session data");
      const data = JSON.parse(Buffer.from(embedded[1], "base64").toString("utf8"));
      assert.equal(data.entries[0].message.content, "export-fixture-message");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
