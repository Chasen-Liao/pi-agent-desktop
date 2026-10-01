import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { McpClient, StdioTransport, StreamableHttpTransport } from "@earendil-works/pi-mcp";
import { writeFileAtomic } from "./atomic-write.ts";
import { getAgentDir, type LoadedMcpConfig, type McpServerConfig as NativeMcpServerConfig } from "@earendil-works/pi-coding-agent";

export type McpTransportType = "stdio" | "http" | "sse";

export interface McpServerConfig {
  id: string; // unique key in mcpServers dictionary
  name?: string;
  transport?: McpTransportType; // default "stdio"
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string; // Streamable HTTP endpoint
  disabled?: boolean;
  type?: "stdio" | "http";
  enabled?: boolean;
  exposure?: "direct" | "codemode" | "codemode-deferred" | "deferred" | "hidden";
  headers?: Record<string, string>;
  cwd?: string;
  oauth?: Record<string, unknown>;
  toolExposure?: Record<string, string>;
  timeout?: number;
}

export interface McpConfigFile {
  mcpServers?: Record<string, Omit<McpServerConfig, "id">>;
  [key: string]: unknown;
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

function isMcpEntry(value: unknown): value is Omit<McpServerConfig, "id"> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
      return { ...obj, mcpServers: {} };
    }
    return { ...obj, mcpServers: obj.mcpServers as Record<string, Omit<McpServerConfig, "id">> };
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
  // Never replace a malformed existing configuration with an empty one.
  if (existsSync(path)) {
    const previous: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!previous || typeof previous !== "object" || Array.isArray(previous)) throw new Error("MCP configuration must be an object");
    const entries = (previous as McpConfigFile).mcpServers;
    if (entries !== undefined && (!entries || typeof entries !== "object" || Array.isArray(entries))) throw new Error("mcpServers must be an object");
  }
  mkdirSync(dirname(path), { recursive: true });
  const formatted: McpConfigFile = {
    ...config,
    mcpServers: config.mcpServers ?? {},
  };
  writeFileAtomic(path, `${JSON.stringify(formatted, null, 2)}\n`);
}

export function getMcpServers(cwd?: string, options?: McpOptions): McpServerStatus[] {
  const serversMap = new Map<string, McpServerStatus>();

  // Global servers
  const globalConfig = readMcpConfig("global", undefined, options);
  for (const [id, s] of Object.entries(globalConfig.mcpServers ?? {})) {
    if (!isMcpEntry(s)) continue;
    const disabled = s.enabled === false || Boolean(s.disabled);
    serversMap.set(id, {
      id,
      scope: "global",
      status: disabled ? "disabled" : "disconnected",
      ...s,
      transport: s.transport ?? s.type ?? (s.url ? "http" : "stdio"),
      disabled,
    });
  }

  // Project servers (override global if same key)
  if (cwd) {
    const projectConfig = readMcpConfig("project", cwd, options);
    for (const [id, s] of Object.entries(projectConfig.mcpServers ?? {})) {
      if (!isMcpEntry(s)) continue;
      const disabled = s.enabled === false || Boolean(s.disabled);
      serversMap.set(id, {
        id,
        scope: "project",
        status: disabled ? "disabled" : "disconnected",
        ...s,
        transport: s.transport ?? s.type ?? (s.url ? "http" : "stdio"),
        disabled,
      });
    }
  }

  return Array.from(serversMap.values());
}

/** Only adapt legacy desktop fields; Pi owns connection, auth and tool registration. */
export function loadDesktopMcpConfig(agentDir: string, cwd: string, projectTrusted: boolean): LoadedMcpConfig {
  const errors: string[] = [];
  const servers: LoadedMcpConfig["servers"] = [];
  const scopes = projectTrusted ? ["global", "project"] as const : ["global"] as const;
  const merged = new Map<string, LoadedMcpConfig["servers"][number]>();
  for (const scope of scopes) {
    const source = getMcpConfigPath(scope, cwd, { agentDir });
    if (!existsSync(source)) continue;
    try {
      const config = JSON.parse(readFileSync(source, "utf-8")) as McpConfigFile;
      for (const [name, entry] of Object.entries(config.mcpServers ?? {})) {
        if (!isMcpEntry(entry)) {
          errors.push(`${source}: server "${name}" must be an object`);
          continue;
        }
        if (entry.transport === "sse") {
          merged.delete(name);
          errors.push(`${name}: legacy SSE is not supported; configure a Streamable HTTP endpoint`);
          continue;
        }
        const { transport, disabled, ...native } = entry;
        merged.set(name, {
          name, scope, source,
          config: { ...native, type: native.type ?? transport ?? (native.url ? "http" : "stdio"), enabled: !(native.enabled === false || Boolean(disabled)) } as NativeMcpServerConfig,
        });
      }
    } catch {
      errors.push(`Could not read MCP configuration: ${source}`);
    }
  }
  servers.push(...merged.values());
  // The desktop switch is authoritative; MCP must not turn Codemode back on.
  return { servers, errors, autoEnableCodemode: false };
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
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Server id must contain only letters, digits, underscores or hyphens");
  const transport = serverConfig.transport ?? serverConfig.type ?? (serverConfig.url ? "http" : "stdio");
  if (transport === "sse") throw new Error("Pi supports Streamable HTTP, not legacy SSE. Configure an HTTP MCP endpoint instead.");
  if (transport !== "stdio" && transport !== "http") throw new Error("Invalid MCP transport");
  if (transport === "stdio" && !serverConfig.command?.trim()) throw new Error("Command is required for stdio transport");
  if (transport === "http") {
    const url = new URL(serverConfig.url ?? "");
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("MCP URL must use HTTP or HTTPS");
  }
  const config = readMcpConfig(scope, cwd, options);
  const currentServers = config.mcpServers ? { ...config.mcpServers } : {};

  const rest: Partial<McpServerConfig> = { ...serverConfig };
  delete rest.id;
  delete rest.transport;
  delete rest.disabled;
  const entry: Omit<McpServerConfig, "id"> = {
    ...currentServers[id],
    ...rest,
    type: transport,
    enabled: serverConfig.disabled !== undefined ? !serverConfig.disabled : serverConfig.enabled ?? true,
    exposure: serverConfig.exposure ?? currentServers[id]?.exposure ?? "direct",
  };
  delete entry.transport;
  delete entry.disabled;
  if (transport === "http") {
    delete entry.command;
    delete entry.args;
    delete entry.env;
  } else {
    delete entry.url;
    delete entry.headers;
    delete entry.oauth;
  }

  currentServers[id] = entry;
  writeMcpConfig(scope, { ...config, mcpServers: currentServers }, cwd, options);

  const disabled = entry.enabled === false;
  return {
    id,
    scope,
    status: disabled ? "disabled" : "disconnected",
    ...entry,
    transport,
    disabled,
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
  writeMcpConfig(scope, { ...config, mcpServers: currentServers }, cwd, options);
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
    enabled: !disabled,
  };
  delete currentServers[id].disabled;

  writeMcpConfig(scope, { ...config, mcpServers: currentServers }, cwd, options);
  return true;
}
export interface TestMcpServerOptions {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: McpTransportType;
  headers?: Record<string, string>;
  cwd?: string;
}

export interface TestMcpServerResult {
  success: boolean;
  message?: string;
  toolsCount?: number;
}

/** A user-requested protocol probe; session connections remain owned by Pi. */
export async function testMcpServerConnection(options: TestMcpServerOptions): Promise<TestMcpServerResult> {
  const client = new McpClient({ name: "pi-desktop-probe", version: "1.0.0", requestTimeoutMs: 5000 });
  const resolveValues = (values?: Record<string, string>) => Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => {
    if (value.startsWith("!")) throw new Error("Command-valued credentials are resolved by Pi during the session; use /mcp to check this server.");
    return [key, value.replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? "")];
  }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (options.transport === "sse") throw new Error("Legacy SSE is not supported; use Streamable HTTP.");
    const transport = options.url
      ? new StreamableHttpTransport({ url: options.url, headers: resolveValues(options.headers), openGetStream: false })
      : new StdioTransport({ command: options.command ?? "", args: options.args, env: resolveValues(options.env), cwd: options.cwd });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { void client.close(); reject(new Error("MCP connection timed out")); }, 7000);
    });
    const tools = await Promise.race([(async () => { await client.connect(transport); return client.listTools(); })(), timeout]);
    return { success: true, toolsCount: tools.length };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    if (timer) clearTimeout(timer);
    await client.close();
  }
}
