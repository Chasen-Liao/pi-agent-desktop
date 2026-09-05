import { isAgentMode, type AgentMode } from "./approval-policy.ts";
import type { SessionEntry } from "./types.ts";

export interface AgentModeCustomData {
  mode: AgentMode;
}

export function findLastAgentMode(entries: SessionEntry[]): AgentMode | undefined {
  if (!Array.isArray(entries)) return undefined;

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry && entry.type === "custom" && entry.customType === "desktop_agent_mode") {
      const data = entry.data as AgentModeCustomData | undefined;
      if (data && isAgentMode(data.mode)) {
        return data.mode;
      }
    }
  }

  return undefined;
}
