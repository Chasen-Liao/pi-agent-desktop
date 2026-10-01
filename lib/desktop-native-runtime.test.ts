import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession, createCodemodeExtension, createMcpExtension,
  createToolSearchExtension, DefaultResourceLoader, SessionManager,
} from "@earendil-works/pi-coding-agent";
import { desktopApprovalInlineExtension, type AgentModeRef } from "./desktop-approval-extension.ts";
import { desktopRuntimeTools } from "./desktop-runtime-tools.ts";
import { loadDesktopMcpConfig, saveMcpServer, testMcpServerConnection } from "./mcp-config.ts";

const fixture = `import { createInterface } from 'node:readline';
createInterface({input:process.stdin}).on('line', line => {
  const request=JSON.parse(line);
  if(request.id === undefined) return;
  let result = {};
  if(request.method==='initialize') result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
  if(request.method==='tools/list') result={tools:[{name:'echo',description:'Echo test text',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]};
  if(request.method==='tools/call') result={content:[{type:'text',text:request.params.arguments.text}]};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});`;

test("native MCP handshake, discovery, invocation and Codemode nested permissions", { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-native-runtime-"));
  const serverPath = join(dir, "server.mjs");
  writeFileSync(serverPath, fixture);
  const ref: AgentModeRef = { current: "full", toolPreset: "default", codemodeEnabled: true };
  saveMcpServer("global", { id: "fixture", command: process.execPath, args: [serverPath], exposure: "codemode" }, undefined, { agentDir: dir });
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, extensionFactories: [
    createCodemodeExtension({ mode: "on", models: false }), createToolSearchExtension(),
    createMcpExtension({ loadConfig: () => loadDesktopMcpConfig(dir, dir, false) }),
    desktopApprovalInlineExtension(ref),
  ] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: dir, agentDir: dir, resourceLoader: loader, sessionManager: SessionManager.inMemory(dir), noTools: "builtin" });
  try {
    const probe = await testMcpServerConnection({ command: process.execPath, args: [serverPath] });
    assert.deepEqual(probe, { success: true, toolsCount: 1 });
    await session.bindExtensions({ mode: "rpc", uiContext: { confirm: async () => false, notify: () => {} } as never });
    for (let attempt = 0; !session.getAllTools().some((tool) => tool.name === "mcp__fixture__echo"); attempt++) {
      assert.ok(attempt < 300, "MCP discovery timed out");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    session.setActiveToolsByName(desktopRuntimeTools(ref.current, "default", true, session.getAllTools()));
    assert.ok(session.getActiveToolNames().includes("codemode"));
    assert.ok(!session.getActiveToolNames().includes("mcp__fixture__echo"), "script-only MCP tools must not be declared directly");
    session.sessionManager.appendMessage({
      role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture",
      content: [{ type: "toolCall", id: "test-parent", name: "codemode", arguments: {} }],
      stopReason: "toolUse", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    });
    session.refreshContext();
    session.setActiveToolsByName(desktopRuntimeTools(ref.current, "default", true, session.getAllTools()));
    const ctx = session.extensionRunner.createToolContext("test-parent", undefined);
    const code = { code: 'console.log(await tools.mcp__fixture__echo({text: "native-ok"}));' };
    // Codemode itself is model-only (not recursively callable by scripts).
    // Execute the registered native definition; its nested calls use Pi's pipeline.
    const codemode = session.extensionRunner.getAllRegisteredTools().find((tool) => tool.definition.name === "codemode")!;
    const result = await codemode.definition.execute("test-parent", code, undefined, undefined, ctx);
    assert.match(JSON.stringify(result.content), /native-ok/);
    const search = session.extensionRunner.getAllRegisteredTools().find(tool => tool.definition.name === "tool_search")!;
    await search.definition.execute("test-search", { query: "echo", limit: 1 }, undefined, undefined, ctx);
    assert.ok(session.getActiveToolNames().includes("mcp__fixture__echo"));
    await session.extensionRunner.emitBeforeAgentStart("next prompt", undefined, { cwd: dir });
    assert.ok(session.getActiveToolNames().includes("mcp__fixture__echo"), "search activation must survive the next prompt");
    ref.current = "ask";
    const blocked = await ctx.executeTool("mcp__fixture__echo", { text: "must-not-run" });
    assert.equal(blocked.isError, true);
    assert.match(JSON.stringify(blocked), /Blocked/);
    ref.current = "plan";
    await session.extensionRunner.emitBeforeAgentStart("plan prompt", undefined, { cwd: dir });
    assert.ok(!session.getActiveToolNames().includes("mcp__fixture__echo"), "Plan must still remove MCP declarations");
    const event = { type: "tool_call" as const, toolName: "codemode", toolCallId: "test-parent", input: code };
    assert.equal((await session.extensionRunner.emitToolCall(event))?.block, true);
    ref.current = "full";
    ref.codemodeEnabled = false;
    assert.equal((await session.extensionRunner.emitToolCall(event))?.block, true);
  } finally {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("non-MCP processes are not reported as successful protocol connections", async () => {
  const result = await testMcpServerConnection({ command: process.execPath, args: ["-v"] });
  assert.equal(result.success, false);
});
