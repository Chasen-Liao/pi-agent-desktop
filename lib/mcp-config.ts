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
  auth?: { provider: string };
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

function isMcpEntry(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Provider credentials must never be selected by a project or sent over remote HTTP. */
function providerAuthError(config: Record<string, unknown>, scope: "global" | "project"): string | undefined {
  if (config.auth === undefined) return;
  if (scope === "project") return "auth is only allowed in the global mcp.json";
  if (!isMcpEntry(config.auth) || typeof config.auth.provider !== "string" || !config.auth.provider.trim()) {
    return "auth.provider must be a provider name";
  }
  const url = typeof config.url === "string" && URL.canParse(config.url) ? new URL(config.url) : undefined;
  if (!url || !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    return "auth requires an https URL, or http on localhost, 127.0.0.1, or [::1]";
  }
}

function adaptMcpEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const { transport, disabled, ...native } = entry;
  if (native.type === undefined && transport !== undefined) native.type = transport;
  if (native.type === "streamable-http") native.type = "http";
  if (native.enabled !== undefined || disabled !== undefined) {
    // Preserve the legacy rule: either disabling field wins.
    if (native.enabled === undefined || typeof native.enabled === "boolean") {
      native.enabled = !(native.enabled === false || Boolean(disabled));
    }
  }
  if (native.exposure === "codemode-deferred") native.exposure = "codemode";
  if (isMcpEntry(native.toolExposure)) {
    native.toolExposure = Object.fromEntries(Object.entries(native.toolExposure).map(([tool, exposure]) => [tool, exposure === "codemode-deferred" ? "codemode" : exposure]));
  }
  return native;
}

function exposureError(config: Record<string, unknown>): string | undefined {
  const exposures: unknown[] = ["codemode", "deferred", "direct", "hidden"];
  if (config.enabled !== undefined && typeof config.enabled !== "boolean") return "enabled must be a boolean";
  if (config.exposure !== undefined && !exposures.includes(config.exposure)) return "invalid exposure";
  if (config.toolExposure !== undefined && (!isMcpEntry(config.toolExposure) || Object.values(config.toolExposure).some(value => !exposures.includes(value)))) {
    return "toolExposure must map tool names to valid exposures";
  }
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
  const loaded = loadDesktopMcpConfig(options?.agentDir ?? getAgentDir(), cwd ?? process.cwd(), cwd !== undefined);
  return loaded.servers.map(entry => {
    const config = entry.config as Omit<McpServerConfig, "id">;
    const disabled = config.enabled === false;
    return {
      ...config,
      id: entry.name,
      scope: entry.override ? "project" : entry.scope === "project" ? "project" : "global",
      status: disabled ? "disabled" : "disconnected",
      transport: config.type ?? (config.url ? "http" : "stdio"),
      disabled,
    };
  });
}

/** Only adapt legacy desktop fields; Pi owns connection, auth and tool registration. */
export function loadDesktopMcpConfig(agentDir: string, cwd: string, projectTrusted: boolean): LoadedMcpConfig {
  const errors: string[] = [];
  const scopes = projectTrusted ? ["global", "project"] as const : ["global"] as const;
  const merged = new Map<string, LoadedMcpConfig["servers"][number]>();
  for (const scope of scopes) {
    const source = getMcpConfigPath(scope, cwd, { agentDir });
    if (!existsSync(source)) continue;
    try {
      const config: unknown = JSON.parse(readFileSync(source, "utf-8"));
      if (!isMcpEntry(config) || (config.mcpServers !== undefined && !isMcpEntry(config.mcpServers))) {
        errors.push(`${source}: expected an object with an mcpServers object`);
        continue;
      }
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
        const native = adaptMcpEntry(entry);
        const authError = providerAuthError(native, scope);
        const invalidExposure = exposureError(native);
        if (authError || invalidExposure) {
          errors.push(`${source}: server "${name}": ${authError ?? invalidExposure}`);
          continue;
        }
        if (scope === "project" && native.command === undefined && native.url === undefined && native.type === undefined) {
          const base = merged.get(name);
          const extra = Object.keys(native).filter(key => !["enabled", "exposure", "toolExposure"].includes(key));
          if (!base || extra.length > 0) {
            errors.push(`${source}: server "${name}": ${!base ? "needs a global server to override" : "an override can only set enabled, exposure and toolExposure"}`);
            continue;
          }
          merged.set(name, { ...base, config: { ...base.config, ...native }, override: source });
          continue;
        }
        const type = native.type ?? (native.url ? "http" : "stdio");
        if ((type === "http" && (typeof native.url !== "string" || !URL.canParse(native.url) || !["http:", "https:"].includes(new URL(native.url).protocol))) ||
            (type === "stdio" && (typeof native.command !== "string" || !native.command.trim())) ||
            (type !== "http" && type !== "stdio")) {
          errors.push(`${source}: server "${name}": needs a valid command (stdio) or URL (HTTP)`);
          continue;
        }
        merged.set(name, {
          name, scope, source,
          config: { ...native, type, enabled: native.enabled ?? true } as NativeMcpServerConfig,
        });
      }
    } catch {
      errors.push(`Could not read MCP configuration: ${source}`);
    }
  }
  // The desktop switch is authoritative; MCP must not turn Codemode back on.
  return {
    servers: [...merged.values()], errors, autoEnableCodemode: false,
    ...(projectTrusted ? { projectConfig: getMcpConfigPath("project", cwd, { agentDir }) } : {}),
  };
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
  const authError = providerAuthError({ ...serverConfig }, scope);
  if (authError) throw new Error(authError);
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
    delete entry.auth;
  }

  const savedAuthError = providerAuthError({ ...entry }, scope);
  if (savedAuthError) throw new Error(savedAuthError);

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
