import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { spawn } from "child_process";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type McpTransportType = "stdio" | "sse";

export interface McpServerConfig {
  id: string; // unique key in mcpServers dictionary
  name?: string;
  transport?: McpTransportType; // default "stdio"
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string; // for SSE transport
  disabled?: boolean;
}

export interface McpConfigFile {
  mcpServers?: Record<string, Omit<McpServerConfig, "id">>;
}

export interface McpServerStatus extends McpServerConfig {
  scope: "global" | "project";
  status: "connected" | "disconnected" | "error" | "disabled";
  toolsCount?: number;
  errorMessage?: string;
}

export interface McpOptions {
  agentDir?: string;
}

export function getMcpConfigPath(
  scope: "global" | "project",
  cwd?: string,
  options?: McpOptions
): string {
  if (scope === "global") {
    return join(options?.agentDir ?? getAgentDir(), "mcp.json");
  }
  if (!cwd) {
    throw new Error("cwd is required for project scope");
  }
  return join(cwd, ".pi", "mcp.json");
}

export function readMcpConfig(
  scope: "global" | "project",
  cwd?: string,
  options?: McpOptions
): McpConfigFile {
  const path = getMcpConfigPath(scope, cwd, options);
  if (!existsSync(path)) {
    return { mcpServers: {} };
  }
  try {
    const content = readFileSync(path, "utf-8");
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { mcpServers: {} };
    }
    const obj = parsed as Record<string, unknown>;
    if (!obj.mcpServers || typeof obj.mcpServers !== "object" || Array.isArray(obj.mcpServers)) {
      return { mcpServers: {} };
    }
    return { mcpServers: obj.mcpServers as Record<string, Omit<McpServerConfig, "id">> };
  } catch {
    return { mcpServers: {} };
  }
}

export function writeMcpConfig(
  scope: "global" | "project",
  config: McpConfigFile,
  cwd?: string,
  options?: McpOptions
): void {
  const path = getMcpConfigPath(scope, cwd, options);
  mkdirSync(dirname(path), { recursive: true });
  const formatted: McpConfigFile = {
    mcpServers: config.mcpServers ?? {},
  };
  writeFileSync(path, `${JSON.stringify(formatted, null, 2)}\n`, "utf-8");
}

export function getMcpServers(cwd?: string, options?: McpOptions): McpServerStatus[] {
  const serversMap = new Map<string, McpServerStatus>();

  // Global servers
  const globalConfig = readMcpConfig("global", undefined, options);
  for (const [id, s] of Object.entries(globalConfig.mcpServers ?? {})) {
    const disabled = Boolean(s.disabled);
    serversMap.set(id, {
      id,
      scope: "global",
      status: disabled ? "disabled" : "disconnected",
      transport: s.transport ?? "stdio",
      ...s,
    });
  }

  // Project servers (override global if same key)
  if (cwd) {
    const projectConfig = readMcpConfig("project", cwd, options);
    for (const [id, s] of Object.entries(projectConfig.mcpServers ?? {})) {
      const disabled = Boolean(s.disabled);
      serversMap.set(id, {
        id,
        scope: "project",
        status: disabled ? "disabled" : "disconnected",
        transport: s.transport ?? "stdio",
        ...s,
      });
    }
  }

  return Array.from(serversMap.values());
}

export function saveMcpServer(
  scope: "global" | "project",
  serverConfig: McpServerConfig,
  cwd?: string,
  options?: McpOptions
): McpServerStatus {
  if (!serverConfig.id || typeof serverConfig.id !== "string" || !serverConfig.id.trim()) {
    throw new Error("Server id is required");
  }

  const id = serverConfig.id.trim();
  const config = readMcpConfig(scope, cwd, options);
  const currentServers = config.mcpServers ? { ...config.mcpServers } : {};

  const { id: _ignoreId, ...rest } = serverConfig;
  const entry: Omit<McpServerConfig, "id"> = {
    ...rest,
    transport: rest.transport ?? "stdio",
    disabled: Boolean(rest.disabled),
  };

  currentServers[id] = entry;
  writeMcpConfig(scope, { mcpServers: currentServers }, cwd, options);

  const disabled = Boolean(entry.disabled);
  return {
    id,
    scope,
    status: disabled ? "disabled" : "disconnected",
    ...entry,
  };
}

export function removeMcpServer(
  scope: "global" | "project",
  serverId: string,
  cwd?: string,
  options?: McpOptions
): boolean {
  if (!serverId || typeof serverId !== "string") {
    return false;
  }
  const id = serverId.trim();
  const config = readMcpConfig(scope, cwd, options);
  if (!config.mcpServers || !(id in config.mcpServers)) {
    return false;
  }

  const currentServers = { ...config.mcpServers };
  delete currentServers[id];
  writeMcpConfig(scope, { mcpServers: currentServers }, cwd, options);
  return true;
}

export function toggleMcpServer(
  scope: "global" | "project",
  serverId: string,
  disabled: boolean,
  cwd?: string,
  options?: McpOptions
): boolean {
  if (!serverId || typeof serverId !== "string") {
    return false;
  }
  const id = serverId.trim();
  const config = readMcpConfig(scope, cwd, options);
  if (!config.mcpServers || !(id in config.mcpServers)) {
    return false;
  }

  const currentServers = { ...config.mcpServers };
  currentServers[id] = {
    ...currentServers[id],
    disabled,
  };

  writeMcpConfig(scope, { mcpServers: currentServers }, cwd, options);
  return true;
}
export interface TestMcpServerOptions {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: McpTransportType;
}

export interface TestMcpServerResult {
  success: boolean;
  message?: string;
  toolsCount?: number;
}

export async function testMcpServerConnection(
  options: TestMcpServerOptions
): Promise<TestMcpServerResult> {
  const { command, args, env, url, transport } = options;

  if (transport === "sse" || url) {
    if (!url) {
      return { success: false, message: "URL is required for SSE transport" };
    }
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "text/event-stream, */*" },
      });
      if (response.ok) {
        return {
          success: true,
          message: `Successfully reached SSE endpoint (${response.status})`,
          toolsCount: 0,
        };
      } else {
        return {
          success: false,
          message: `SSE endpoint returned HTTP status ${response.status}`,
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Failed to connect to SSE endpoint: ${msg}`,
      };
    }
  }

  if (!command) {
    return { success: false, message: "Command is required for stdio transport" };
  }

  return new Promise<TestMcpServerResult>((resolve) => {
    try {
      const child = spawn(command, args ?? [], {
        env: { ...process.env, ...env },
        stdio: "pipe",
        shell: false,
      });

      let spawned = true;
      let errorMessage: string | null = null;
      let resolved = false;

      const safeResolve = (res: TestMcpServerResult) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(res);
        }
      };

      child.on("error", (err: Error) => {
        spawned = false;
        errorMessage = err.message;
        safeResolve({
          success: false,
          message: `Failed to spawn process: ${err.message}`,
        });
      });

      const timer = setTimeout(() => {
        if (spawned) {
          try {
            child.kill();
          } catch {}
          safeResolve({
            success: true,
            message: `Process ${command} spawned successfully`,
            toolsCount: 0,
          });
        }
      }, 500);

      child.on("exit", (code: number | null) => {
        if (spawned && errorMessage === null) {
          if (code !== 0 && code !== null) {
            safeResolve({
              success: false,
              message: `Process exited with failure code ${code}`,
            });
          } else {
            safeResolve({
              success: true,
              message: `Process ${command} spawned successfully`,
              toolsCount: 0,
            });
          }
        }
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      resolve({
        success: false,
        message: `Execution failed: ${msg}`,
      });
    }
  });
}
