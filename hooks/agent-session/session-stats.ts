import type { AgentMessage, AssistantMessage } from "../../lib/types";

export interface SessionStats {
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  cost?: number;
}

export function calculateSessionStats(messages: AgentMessage[]): SessionStats | null {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost = 0;

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const usage = (msg as AssistantMessage).usage;
    if (!usage) continue;
    tokens.input += usage.input ?? 0;
    tokens.output += usage.output ?? 0;
    tokens.cacheRead += usage.cacheRead ?? 0;
    tokens.cacheWrite += usage.cacheWrite ?? 0;
    cost += usage.cost?.total ?? 0;
  }

  const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return total > 0 ? { tokens, cost } : null;
}
