/**
 * Whitelist of command types accepted by POST /api/agent/[id] → session.send().
 * Must stay in sync with the `switch (type)` cases in lib/rpc-manager.ts.
 * Defense in depth: even if middleware Origin check is bypassed, malformed
 * commands are rejected at the route boundary instead of relying on pi's
 * internal throw (which could leak error details via errorMessage).
 */
const AGENT_COMMAND_TYPE_LIST = [
  "prompt",
  "abort",
  "get_state",
  "set_model",
  "fork",
  "navigate_tree",
  "set_thinking_level",
  "compact",
  "set_auto_compaction",
  "steer",
  "follow_up",
  "get_tools",
  "set_tools",
  "abort_compaction",
  "set_auto_retry",
] as const;

export type AgentCommandType = (typeof AGENT_COMMAND_TYPE_LIST)[number];

export const AGENT_COMMAND_TYPES: ReadonlySet<AgentCommandType> = new Set(
  AGENT_COMMAND_TYPE_LIST
);

/**
 * Minimal structural validation for an incoming agent command.
 * Returns an error message string if invalid, null if valid.
 *
 * NOTE: This is intentionally minimal — we check `type` is whitelisted and
 * that the body is an object. Deep field validation is left to
 * lib/rpc-manager.ts / pi (which will throw on malformed payloads,
 * surfaced as 500 with sanitized errorMessage).
 */
export function validateAgentCommand(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return "Command body must be an object";
  }
  const cmd = body as { type?: unknown };
  if (typeof cmd.type !== "string") {
    return "Command type must be a string";
  }
  if (!AGENT_COMMAND_TYPES.has(cmd.type as AgentCommandType)) {
    return `Unknown command type: ${cmd.type}`;
  }
  return null;
}
