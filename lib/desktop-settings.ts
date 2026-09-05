/**
 * Desktop-only defaults stored at ~/.pi/agent/desktop-settings.json
 * (separate from pi settings.json).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  DEFAULT_AGENT_MODE,
  DEFAULT_TOOL_PRESET,
  isAgentMode,
  isToolPreset,
  type AgentMode,
  type ToolPreset,
} from "./approval-policy.ts";

/** Optional nested LTM overrides in desktop-settings.json (`ltm`). */
export interface DesktopLtmSettings {
  enabled?: boolean;
  dbPath?: string;
  observeAgentEnd?: boolean;
  observePreCompact?: boolean;
}

export interface DesktopSettings {
  defaultAgentMode: AgentMode;
  defaultToolPreset: ToolPreset;
  /** Optional LTM config; omitted when unset. Merged by getLtmConfig. */
  ltm?: DesktopLtmSettings;
}

const DESKTOP_SETTINGS_FILENAME = "desktop-settings.json";

export function defaultDesktopSettings(): DesktopSettings {
  return {
    defaultAgentMode: DEFAULT_AGENT_MODE,
    defaultToolPreset: DEFAULT_TOOL_PRESET,
  };
}

function desktopSettingsPath(agentDir: string): string {
  return join(agentDir, DESKTOP_SETTINGS_FILENAME);
}

function mergeDesktopLtmSettings(raw: unknown): DesktopLtmSettings | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: DesktopLtmSettings = {};
  if (typeof o.enabled === "boolean") out.enabled = o.enabled;
  if (typeof o.dbPath === "string") out.dbPath = o.dbPath;
  if (typeof o.observeAgentEnd === "boolean") out.observeAgentEnd = o.observeAgentEnd;
  if (typeof o.observePreCompact === "boolean") out.observePreCompact = o.observePreCompact;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function mergeDesktopSettings(raw: unknown): DesktopSettings {
  const base = defaultDesktopSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const obj = raw as Record<string, unknown>;
  const ltm = mergeDesktopLtmSettings(obj.ltm);
  const result: DesktopSettings = {
    defaultAgentMode: isAgentMode(obj.defaultAgentMode) ? obj.defaultAgentMode : base.defaultAgentMode,
    defaultToolPreset: isToolPreset(obj.defaultToolPreset)
      ? obj.defaultToolPreset
      : base.defaultToolPreset,
  };
  if (ltm) result.ltm = ltm;
  return result;
}

export function readDesktopSettings(agentDir: string): DesktopSettings {
  const path = desktopSettingsPath(agentDir);
  if (!existsSync(path)) return defaultDesktopSettings();
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return mergeDesktopSettings(parsed);
  } catch {
    return defaultDesktopSettings();
  }
}

export function writeDesktopSettings(agentDir: string, settings: DesktopSettings): DesktopSettings {
  const merged = mergeDesktopSettings(settings);
  const path = desktopSettingsPath(agentDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
  return merged;
}

/** Validate PUT body; returns error string or null. */
export function validateDesktopSettingsBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Body must be an object";
  }
  const obj = body as Record<string, unknown>;
  if (obj.defaultAgentMode !== undefined && !isAgentMode(obj.defaultAgentMode)) {
    return "defaultAgentMode must be plan | ask | full";
  }
  if (obj.defaultToolPreset !== undefined && !isToolPreset(obj.defaultToolPreset)) {
    return "defaultToolPreset must be none | default | full";
  }
  if (obj.ltm !== undefined) {
    if (!obj.ltm || typeof obj.ltm !== "object" || Array.isArray(obj.ltm)) {
      return "ltm must be an object";
    }
    const ltm = obj.ltm as Record<string, unknown>;
    if (ltm.enabled !== undefined && typeof ltm.enabled !== "boolean") {
      return "ltm.enabled must be a boolean";
    }
    if (ltm.dbPath !== undefined && typeof ltm.dbPath !== "string") {
      return "ltm.dbPath must be a string";
    }
    if (ltm.observeAgentEnd !== undefined && typeof ltm.observeAgentEnd !== "boolean") {
      return "ltm.observeAgentEnd must be a boolean";
    }
    if (
      ltm.observePreCompact !== undefined &&
      typeof ltm.observePreCompact !== "boolean"
    ) {
      return "ltm.observePreCompact must be a boolean";
    }
  }
  return null;
}
