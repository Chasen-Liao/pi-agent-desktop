import type { CustomEntry, SessionEntry } from "./types.ts";

export type AgentMode = "plan" | "ask" | "full";

export interface AgentModeCustomData {
  mode: AgentMode;
}

const VALID_MODES: AgentMode[] = ["plan", "ask", "full"];

export function isValidAgentMode(mode: unknown): mode is AgentMode {
  return typeof mode === "string" && (VALID_MODES as string[]).includes(mode);
}

export function findLastAgentMode(entries: SessionEntry[]): AgentMode | undefined {
  if (!Array.isArray(entries)) return undefined;

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry && entry.type === "custom" && entry.customType === "desktop_agent_mode") {
      const data = entry.data as AgentModeCustomData | undefined;
      if (data && isValidAgentMode(data.mode)) {
        return data.mode;
      }
    }
  }

  return undefined;
}

export function createAgentModeCustomEntry(
  mode: AgentMode,
  parentId: string | null = null
): CustomEntry {
  if (!isValidAgentMode(mode)) {
    throw new Error(`Invalid agent mode: ${String(mode)}`);
  }

  return {
    type: "custom",
    customType: "desktop_agent_mode",
    id: crypto.randomUUID(),
    parentId,
    timestamp: new Date().toISOString(),
    data: { mode },
  };
}
