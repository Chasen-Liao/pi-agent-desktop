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

test("project MCP definitions cannot select a provider credential", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-project-auth-"));
  const agentDir = join(dir, "agent");
  try {
    saveMcpServer("global", { id: "safe", command: "node" }, undefined, { agentDir });
    mkdirSync(join(dir, ".pi"));
    writeFileSync(join(dir, ".pi", "mcp.json"), JSON.stringify({ mcpServers: {
      unsafe: { url: "https://example.com/mcp", auth: { provider: "openai" }, exposure: "direct" },
    } }));
    const loaded = loadDesktopMcpConfig(agentDir, dir, true);
    assert.deepEqual(loaded.servers.map(server => server.name), ["safe"]);
    assert.match(loaded.errors.join("\n"), /auth.*global/i);
    assert.deepEqual(getMcpServers(dir, { agentDir }).map(server => server.id), ["safe"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("provider credentials require a valid provider and HTTPS outside loopback", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-auth-url-"));
  try {
    for (const entry of [
      { url: "http://example.com/mcp", auth: { provider: "openai" } },
      { url: "http://localhost.example.com/mcp", auth: { provider: "openai" } },
      { url: "ftp://localhost/mcp", auth: { provider: "openai" } },
      { url: "invalid", auth: { provider: "openai" } },
      { url: "https://example.com/mcp", auth: {} },
      { url: "https://example.com/mcp", auth: null },
      { url: "https://example.com/mcp", auth: { provider: 123 } },
    ]) {
      writeFileSync(join(dir, "mcp.json"), JSON.stringify({ mcpServers: { unsafe: entry } }));
      const loaded = loadDesktopMcpConfig(dir, dir, false);
      assert.equal(loaded.servers.length, 0, JSON.stringify(entry));
      assert.equal(loaded.errors.length, 1);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("global provider authentication permits HTTPS and exact loopback HTTP hosts", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-auth-allowed-"));
  try {
    for (const url of ["https://example.com/mcp", "http://localhost/mcp", "http://127.0.0.1/mcp", "http://[::1]/mcp"]) {
      writeFileSync(join(dir, "mcp.json"), JSON.stringify({ mcpServers: { safe: { url, auth: { provider: "openai" } } } }));
      const loaded = loadDesktopMcpConfig(dir, dir, false);
      assert.deepEqual(loaded.errors, []);
      const config = loaded.servers[0].config;
      assert.ok("url" in config);
      assert.equal(config.url, url);
      assert.deepEqual(config.auth, { provider: "openai" });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("saving cannot bypass provider-auth rules or retarget existing credentials to HTTP", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-save-auth-"));
  const agentDir = join(dir, "agent");
  try {
    const server = { id: "safe", transport: "http" as const, url: "https://example.com/mcp", auth: { provider: "openai" } };
    assert.throws(() => saveMcpServer("project", server, dir, { agentDir }), /auth.*global/);
    assert.equal(readMcpConfig("project", dir, { agentDir }).mcpServers?.safe, undefined);
    saveMcpServer("global", server, undefined, { agentDir });
    assert.throws(() => saveMcpServer("global", { id: "safe", transport: "http", url: "http://example.com/mcp" }, undefined, { agentDir }), /auth.*https/);
    assert.equal(readMcpConfig("global", undefined, { agentDir }).mcpServers?.safe.url, server.url);
    saveMcpServer("global", { id: "safe", command: "node" }, undefined, { agentDir });
    assert.equal(readMcpConfig("global", undefined, { agentDir }).mcpServers?.safe.auth, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("partial project overrides preserve global connection, credentials and ownership", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-partial-"));
  const agentDir = join(dir, "agent");
  try {
    mkdirSync(agentDir);
    mkdirSync(join(dir, ".pi"));
    const globalPath = join(agentDir, "mcp.json");
    const projectPath = join(dir, ".pi", "mcp.json");
    const globalText = JSON.stringify({ mcpServers: { docs: {
      url: "https://example.com/mcp", headers: { "X-Fixture": "test" },
      auth: { provider: "openai" }, exposure: "direct", enabled: false,
    } } });
    const projectText = JSON.stringify({ mcpServers: { docs: {
      enabled: true, exposure: "deferred", toolExposure: { remove: "hidden" },
    } } });
    writeFileSync(globalPath, globalText);
    writeFileSync(projectPath, projectText);
    const loaded = loadDesktopMcpConfig(agentDir, dir, true);
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.projectConfig, projectPath);
    const entry = loaded.servers[0];
    assert.equal(entry.source, globalPath);
    assert.equal(entry.scope, "global");
    assert.equal(entry.override, projectPath);
    assert.ok("url" in entry.config);
    assert.equal(entry.config.url, "https://example.com/mcp");
    assert.deepEqual(entry.config.headers, { "X-Fixture": "test" });
    assert.deepEqual(entry.config.auth, { provider: "openai" });
    assert.equal(entry.config.enabled, true);
    assert.equal(entry.config.exposure, "deferred");
    assert.deepEqual(entry.config.toolExposure, { remove: "hidden" });
    const visible = getMcpServers(dir, { agentDir })[0];
    assert.equal(visible.scope, "project");
    assert.equal(visible.transport, "http");
    assert.equal(visible.url, "https://example.com/mcp");
    assert.equal(visible.disabled, false);
    assert.equal(readFileSync(globalPath, "utf8"), globalText);
    assert.equal(readFileSync(projectPath, "utf8"), projectText);
    assert.equal(loadDesktopMcpConfig(agentDir, dir, false).servers[0].config.enabled, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("legacy partial disable overrides keep the global command when toggled", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-partial-disabled-"));
  const agentDir = join(dir, "agent");
  try {
    saveMcpServer("global", { id: "same", command: "node", args: ["--version"] }, undefined, { agentDir });
    writeMcpConfig("project", { mcpServers: { same: { disabled: true } } }, dir, { agentDir });
    const loaded = loadDesktopMcpConfig(agentDir, dir, true);
    assert.deepEqual(loaded.errors, []);
    assert.ok("command" in loaded.servers[0].config);
    assert.equal(loaded.servers[0].config.command, "node");
    assert.equal(loaded.servers[0].config.enabled, false);
    assert.equal(getMcpServers(dir, { agentDir })[0].status, "disabled");
    assert.equal(toggleMcpServer("project", "same", false, dir, { agentDir }), true);
    assert.equal(loadDesktopMcpConfig(agentDir, dir, true).servers[0].config.enabled, true);
    assert.equal(readMcpConfig("project", dir, { agentDir }).mcpServers?.same.command, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("partial overrides cannot change connection or credential fields", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-partial-invalid-"));
  const agentDir = join(dir, "agent");
  try {
    saveMcpServer("global", { id: "safe", transport: "http", url: "https://example.com/mcp" }, undefined, { agentDir });
    mkdirSync(join(dir, ".pi"));
    for (const patch of [
      { exposure: "direct", auth: { provider: "openai" } },
      { enabled: true, headers: { Authorization: "fixture-only" } },
      { exposure: "unsupported" },
      { toolExposure: { remove: "unsupported" } },
      { enabled: "false" },
    ]) {
      writeFileSync(join(dir, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { safe: patch } }));
      const loaded = loadDesktopMcpConfig(agentDir, dir, true);
      assert.equal(loaded.servers.length, 1);
      assert.equal(loaded.errors.length, 1, JSON.stringify(patch));
      assert.equal(loaded.servers[0].override, undefined);
      assert.equal(loaded.servers[0].scope, "global");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("orphan project overrides report errors instead of creating invalid stdio servers", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-partial-orphan-"));
  try {
    writeMcpConfig("project", { mcpServers: { missing: { enabled: true, exposure: "deferred" } } }, dir, { agentDir: dir });
    const loaded = loadDesktopMcpConfig(dir, dir, true);
    assert.deepEqual(loaded.servers, []);
    assert.match(loaded.errors.join("\n"), /global server/i);
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
