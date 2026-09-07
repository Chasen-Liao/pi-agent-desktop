import { join } from "node:path";
import { readDesktopSettings } from "../desktop-settings.ts";

export interface LtmConfig {
  enabled: boolean;
  dbPath: string;
  observeAgentEnd: boolean;
  observePreCompact: boolean;
}

/** Partial LTM overrides stored under desktop-settings.json `ltm`. */
export type LtmConfigPartial = {
  enabled?: boolean;
  dbPath?: string;
  observeAgentEnd?: boolean;
  observePreCompact?: boolean;
};

export function defaultLtmConfig(agentDir: string): LtmConfig {
  return {
    enabled: true,
    dbPath: join(agentDir, "memory", "ltm.sqlite"),
    observeAgentEnd: true,
    observePreCompact: true,
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
  return {
    enabled:
      typeof partial.enabled === "boolean" ? partial.enabled : base.enabled,
    dbPath,
    observeAgentEnd:
      typeof partial.observeAgentEnd === "boolean"
        ? partial.observeAgentEnd
        : base.observeAgentEnd,
    observePreCompact:
      typeof partial.observePreCompact === "boolean"
        ? partial.observePreCompact
        : base.observePreCompact,
  };
}

/** Read desktop-settings.json `ltm` and merge with defaults for agentDir. */
export function getLtmConfig(agentDir: string): LtmConfig {
  const settings = readDesktopSettings(agentDir);
  return mergeLtmConfig(agentDir, settings.ltm);
}
