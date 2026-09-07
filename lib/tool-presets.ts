import {
  PRESET_DEFAULT,
  PRESET_FULL,
  type ToolPreset,
} from "./approval-policy.ts";

export interface ToolEntry {
  name: string;
  description: string;
  active: boolean;
}

export type { ToolPreset } from "./approval-policy.ts";
export { PRESET_DEFAULT, PRESET_FULL, PRESET_NONE } from "./approval-policy.ts";

function asciiCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function getPresetFromTools(tools: ToolEntry[]): ToolPreset {
  const active: string[] = [];
  for (const t of tools) if (t.active) active.push(t.name);
  active.sort(asciiCompare);
  const joined = active.join(",");
  if (joined === "") return "none";
  if (joined === [...PRESET_DEFAULT].sort(asciiCompare).join(","))
    return "default";
  if (joined === [...PRESET_FULL].sort(asciiCompare).join(",")) return "full";
  return "default"; // closest match
}
