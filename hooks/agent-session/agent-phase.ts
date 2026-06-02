export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_tools"; tools: { id: string; name: string }[] }
  | null;

export function addRunningTool(phase: AgentPhase, id: string, name: string): AgentPhase {
  const tools = phase?.kind === "running_tools" ? [...phase.tools] : [];
  if (!tools.some((tool) => tool.id === id)) tools.push({ id, name });
  return { kind: "running_tools", tools };
}

export function removeRunningTool(phase: AgentPhase, id: string): AgentPhase {
  if (phase?.kind !== "running_tools") return phase;
  const tools = phase.tools.filter((tool) => tool.id !== id);
  if (tools.length === 0) return { kind: "waiting_model" };
  return { kind: "running_tools", tools };
}
