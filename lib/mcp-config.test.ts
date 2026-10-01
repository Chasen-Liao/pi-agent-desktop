import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getMcpConfigPath,
  readMcpConfig,
  writeMcpConfig,
  getMcpServers,
  saveMcpServer,
  removeMcpServer,
  toggleMcpServer,
  loadDesktopMcpConfig,
} from "./mcp-config.ts";

test("native configuration preserves headers, OAuth, exposure and top-level settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-native-"));
  try {
    writeMcpConfig("global", { autoEnableCodemode: false, mcpServers: { remote: { type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer ${TOKEN}" }, oauth: { clientId: "test" }, toolExposure: { dangerous: "hidden" }, enabled: false } } }, undefined, { agentDir: dir });
    const saved = saveMcpServer("global", { id: "remote", transport: "http", url: "https://example.com/mcp", disabled: false, exposure: "deferred" }, undefined, { agentDir: dir });
    assert.equal(saved.disabled, false);
    const native = readMcpConfig("global", undefined, { agentDir: dir });
    assert.equal(native.autoEnableCodemode, false);
    assert.equal(native.mcpServers?.remote.enabled, true);
    assert.equal(native.mcpServers?.remote.disabled, undefined);
    assert.equal(native.mcpServers?.remote.transport, undefined);
    assert.deepEqual(native.mcpServers?.remote.headers, { Authorization: "Bearer ${TOKEN}" });
    assert.deepEqual(native.mcpServers?.remote.oauth, { clientId: "test" });
    const loaded = loadDesktopMcpConfig(dir, dir, false);
    assert.equal(loaded.servers[0].config.exposure, "deferred");
    assert.equal(loaded.autoEnableCodemode, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("MCP project overrides require trust and legacy SSE is not treated as HTTP", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-trust-"));
  const agentDir = join(dir, "agent");
  try {
    saveMcpServer("global", { id: "same", command: "node" }, undefined, { agentDir });
    writeMcpConfig("project", { mcpServers: { same: { command: "project-node", disabled: true }, legacy: { transport: "sse", url: "https://example.com/sse" } } }, dir, { agentDir });
    assert.equal((loadDesktopMcpConfig(agentDir, dir, false).servers[0].config as { command: string }).command, "node");
    const trusted = loadDesktopMcpConfig(agentDir, dir, true);
    assert.equal(trusted.servers.length, 1);
    assert.equal(trusted.servers[0].scope, "project");
    assert.equal(trusted.servers[0].config.enabled, false);
    assert.match(trusted.errors[0], /legacy SSE/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("native and legacy disabled fields agree between UI and runtime", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-enabled-"));
  try {
    for (const enabled of [true, false, undefined]) {
      for (const disabled of [true, false, undefined]) {
        writeMcpConfig("global", { mcpServers: { mixed: { command: "node", enabled, disabled } } }, undefined, { agentDir: dir });
        const visible = getMcpServers(undefined, { agentDir: dir })[0];
        const loaded = loadDesktopMcpConfig(dir, dir, false).servers[0];
        assert.equal(loaded.config.enabled, !visible.disabled);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("editing does not overwrite a malformed MCP file", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-malformed-"));
  try {
    const path = join(dir, "mcp.json");
    writeFileSync(path, "{broken");
    assert.throws(() => saveMcpServer("global", { id: "test", command: "node" }, undefined, { agentDir: dir }));
    assert.equal(readFileSync(path, "utf8"), "{broken");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("malformed MCP entries do not prevent later valid servers from loading", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-entry-"));
  try {
    writeFileSync(join(dir, "mcp.json"), JSON.stringify({ mcpServers: {
      broken: null, array: [], primitive: "invalid", valid: { command: "node" },
    } }));
    const loaded = loadDesktopMcpConfig(dir, dir, false);
    assert.deepEqual(loaded.servers.map(server => server.name), ["valid"]);
    assert.equal(loaded.errors.length, 3);
    assert.deepEqual(getMcpServers(undefined, { agentDir: dir }).map(server => server.id), ["valid"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("getMcpConfigPath resolves paths correctly", () => {
  const customAgentDir = "C:/tmp/custom-agent";
  const globalPath = getMcpConfigPath("global", undefined, { agentDir: customAgentDir });
  assert.equal(globalPath, join(customAgentDir, "mcp.json"));

  const projectPath = getMcpConfigPath("project", "C:/tmp/project");
  assert.equal(projectPath, join("C:/tmp/project", ".pi", "mcp.json"));

  assert.throws(() => {
    getMcpConfigPath("project");
  }, /cwd is required/);
});

test("readMcpConfig handles missing or corrupted files gracefully", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-test-"));
  const agentDir = join(dir, "agent");
  try {
    const missing = readMcpConfig("global", undefined, { agentDir });
    assert.deepEqual(missing, { mcpServers: {} });

    // Corrupted file
    const path = getMcpConfigPath("global", undefined, { agentDir });
    mkdirSync(join(agentDir), { recursive: true });
    writeFileSync(path, "invalid json {", "utf-8");

    const corrupted = readMcpConfig("global", undefined, { agentDir });
    assert.deepEqual(corrupted, { mcpServers: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveMcpServer and getMcpServers round-trip & merge global/project", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-test-"));
  const agentDir = join(dir, "agent");
  const projectDir = join(dir, "project");
  try {
    // 1. Save global server
    const globalServer = saveMcpServer(
      "global",
      {
        id: "github",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "abc" },
      },
      undefined,
      { agentDir }
    );

    assert.equal(globalServer.id, "github");
    assert.equal(globalServer.scope, "global");
    assert.equal(globalServer.status, "disconnected");
    assert.equal(globalServer.transport, "stdio");

    // 2. Save project server
    const projectServer = saveMcpServer(
      "project",
      {
        id: "sqlite",
        transport: "stdio",
        command: "uvx",
        args: ["mcp-server-sqlite"],
      },
      projectDir,
      { agentDir }
    );

    assert.equal(projectServer.id, "sqlite");
    assert.equal(projectServer.scope, "project");

    // 3. Get merged list
    const merged = getMcpServers(projectDir, { agentDir });
    assert.equal(merged.length, 2);

    const github = merged.find((s) => s.id === "github");
    assert.ok(github);
    assert.equal(github?.scope, "global");

    const sqlite = merged.find((s) => s.id === "sqlite");
    assert.ok(sqlite);
    assert.equal(sqlite?.scope, "project");

    // 4. Override global server with project server
    saveMcpServer(
      "project",
      {
        id: "github",
        command: "npx",
        args: ["-y", "custom-github-server"],
      },
      projectDir,
      { agentDir }
    );

    const mergedAfterOverride = getMcpServers(projectDir, { agentDir });
    assert.equal(mergedAfterOverride.length, 2);

    const overriddenGithub = mergedAfterOverride.find((s) => s.id === "github");
    assert.ok(overriddenGithub);
    assert.equal(overriddenGithub?.scope, "project");
    assert.deepEqual(overriddenGithub?.args, ["-y", "custom-github-server"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("toggleMcpServer updates disabled state", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-test-"));
  const agentDir = join(dir, "agent");
  try {
    saveMcpServer(
      "global",
      {
        id: "test-server",
        command: "node",
        disabled: false,
      },
      undefined,
      { agentDir }
    );

    // Non-existent server returns false
    assert.equal(toggleMcpServer("global", "non-existent", true, undefined, { agentDir }), false);

    // Existing server toggles disabled flag
    const ok = toggleMcpServer("global", "test-server", true, undefined, { agentDir });
    assert.equal(ok, true);

    const servers = getMcpServers(undefined, { agentDir });
    const s = servers.find((item) => item.id === "test-server");
    assert.ok(s);
    assert.equal(s?.disabled, true);
    assert.equal(s?.status, "disabled");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removeMcpServer deletes entry from mcp.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-test-"));
  const agentDir = join(dir, "agent");
  try {
    saveMcpServer(
      "global",
      {
        id: "server-a",
        command: "node",
      },
      undefined,
      { agentDir }
    );

    assert.equal(removeMcpServer("global", "unknown", undefined, { agentDir }), false);

    const removed = removeMcpServer("global", "server-a", undefined, { agentDir });
    assert.equal(removed, true);

    const servers = getMcpServers(undefined, { agentDir });
    assert.equal(servers.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
