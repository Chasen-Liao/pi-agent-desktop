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

export interface DesktopSettings {
  defaultAgentMode: AgentMode;
  defaultToolPreset: ToolPreset;
}

export const DESKTOP_SETTINGS_FILENAME = "desktop-settings.json";

export function defaultDesktopSettings(): DesktopSettings {
  return {
    defaultAgentMode: DEFAULT_AGENT_MODE,
    defaultToolPreset: DEFAULT_TOOL_PRESET,
  };
}

export function desktopSettingsPath(agentDir: string): string {
  return join(agentDir, DESKTOP_SETTINGS_FILENAME);
}

export function mergeDesktopSettings(raw: unknown): DesktopSettings {
  const base = defaultDesktopSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const obj = raw as Record<string, unknown>;
  return {
    defaultAgentMode: isAgentMode(obj.defaultAgentMode) ? obj.defaultAgentMode : base.defaultAgentMode,
    defaultToolPreset: isToolPreset(obj.defaultToolPreset)
      ? obj.defaultToolPreset
      : base.defaultToolPreset,
  };
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
  return null;
}
