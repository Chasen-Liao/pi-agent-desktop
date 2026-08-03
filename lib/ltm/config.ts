import { join } from "node:path";
import { readDesktopSettings } from "../desktop-settings.ts";

export type LtmBackendKind = "sqlite" | "agentmemory";

export interface LtmConfig {
  enabled: boolean;
  backend: LtmBackendKind;
  dbPath: string;
  observeAgentEnd: boolean;
  observePreCompact: boolean;
  agentmemoryUrl: string;
}

/** Partial LTM overrides stored under desktop-settings.json `ltm`. */
export type LtmConfigPartial = {
  enabled?: boolean;
  backend?: LtmBackendKind;
  dbPath?: string;
  observeAgentEnd?: boolean;
  observePreCompact?: boolean;
  agentmemoryUrl?: string;
};

export function isLtmBackendKind(value: unknown): value is LtmBackendKind {
  return value === "sqlite" || value === "agentmemory";
}

export function defaultLtmConfig(agentDir: string): LtmConfig {
  return {
    enabled: true,
    backend: "sqlite",
    dbPath: join(agentDir, "memory", "ltm.sqlite"),
    observeAgentEnd: true,
    observePreCompact: true,
    agentmemoryUrl: "http://127.0.0.1:3111",
  };
}

/** Merge a partial (e.g. from desktop-settings) onto defaults for agentDir. */
export function mergeLtmConfig(
  agentDir: string,
  partial: LtmConfigPartial | undefined
): LtmConfig {
  const base = defaultLtmConfig(agentDir);
  if (!partial) return base;

  const dbPath =
    typeof partial.dbPath === "string" && partial.dbPath.trim().length > 0
      ? partial.dbPath.trim()
      : base.dbPath;
  const agentmemoryUrl =
    typeof partial.agentmemoryUrl === "string" &&
    partial.agentmemoryUrl.trim().length > 0
      ? partial.agentmemoryUrl.trim()
      : base.agentmemoryUrl;

  return {
    enabled:
      typeof partial.enabled === "boolean" ? partial.enabled : base.enabled,
    backend: isLtmBackendKind(partial.backend) ? partial.backend : base.backend,
    dbPath,
    observeAgentEnd:
      typeof partial.observeAgentEnd === "boolean"
        ? partial.observeAgentEnd
        : base.observeAgentEnd,
    observePreCompact:
      typeof partial.observePreCompact === "boolean"
        ? partial.observePreCompact
        : base.observePreCompact,
    agentmemoryUrl,
  };
}

/** Read desktop-settings.json `ltm` and merge with defaults for agentDir. */
export function getLtmConfig(agentDir: string): LtmConfig {
  const settings = readDesktopSettings(agentDir);
  return mergeLtmConfig(agentDir, settings.ltm);
}
