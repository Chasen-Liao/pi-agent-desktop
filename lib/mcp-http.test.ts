import test from "node:test";
import { execFileSync } from "node:child_process";

test("native Streamable HTTP probe performs a handshake and discovers tools", { timeout: 15000 }, () => {
  // Windows Node 24 can assert in libuv when forced to exit while fetch's
  // internal handles close. Let this isolated process shut down normally.
  execFileSync(process.execPath, ["--input-type=module", "-e", `
  import assert from "node:assert/strict";
  import { createServer } from "node:http";
  import { testMcpServerConnection } from ${JSON.stringify(new URL("./mcp-config.ts", import.meta.url).href)};
  const methods = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const message = JSON.parse(body);
    methods.push(message.method);
    if (message.id === undefined) { response.writeHead(202).end(); return; }
    const result = message.method === "initialize"
      ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "http-fixture", version: "1" } }
      : { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }] };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await testMcpServerConnection({ transport: "http", url: "http://127.0.0.1:" + server.address().port + "/mcp" });
    assert.deepEqual(result, { success: true, toolsCount: 1 });
    assert.ok(methods.includes("initialize"));
    assert.ok(methods.includes("tools/list"));
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  `], { timeout: 12000, stdio: "pipe" });
});
