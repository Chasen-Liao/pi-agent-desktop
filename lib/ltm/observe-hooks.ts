import {
  buildAgentEndObservation,
  buildPreCompactObservation,
} from "./observe-payload.ts";
import { getMemoryService } from "./service.ts";

/** Pull plain text from user/assistant/toolResult content shapes. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
    } else if (b.type === "thinking" && typeof b.thinking === "string") {
      parts.push(b.thinking);
    }
  }
  return parts.join("\n");
}

/**
 * Resolve a message-like object from either:
 * - agent_end event.messages items: `{ role, content }`
 * - session branch entries: `{ type: "message", message: { role, content } }`
 */
function coerceMessage(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  if (o.type === "message" && o.message && typeof o.message === "object") {
    return o.message as Record<string, unknown>;
  }
  if (typeof o.role === "string") return o;
  return null;
}

/**
 * Last non-empty text for `role` walking source from the end.
 * Accepts branch entries or raw message arrays.
 */
function lastRoleText(source: unknown[], role: "user" | "assistant"): string {
  for (let i = source.length - 1; i >= 0; i--) {
    const message = coerceMessage(source[i]);
    if (!message || message.role !== role) continue;
    const text = contentToText(message.content).trim();
    if (text) return text;
  }
  return "";
}

/** Last user message text from branch entries or message list. */
export function lastUserFromBranch(source: unknown[]): string {
  return lastRoleText(source, "user");
}

/** Last assistant message text from branch entries or message list. */
export function lastAssistantFromBranch(source: unknown[]): string {
  return lastRoleText(source, "assistant");
}

/**
 * Join message text from session branch entries (getBranch()).
 * Only message entries with user / assistant / toolResult roles contribute.
 */
export function branchEntriesToMessagesText(entries: unknown[]): string {
  const chunks: string[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e.type !== "message") continue;

    const message = e.message;
    if (!message || typeof message !== "object") continue;
    const m = message as Record<string, unknown>;
    const role = m.role;
    if (role !== "user" && role !== "assistant" && role !== "toolResult") {
      continue;
    }

    const text = contentToText(m.content).trim();
    if (!text) continue;
    chunks.push(`${role}: ${text}`);
  }

  return chunks.join("\n\n");
}

export interface PreCompactObserveInput {
  sessionId: string;
  cwd: string;
  messagesText: string;
  /** Optional: force agentDir for getMemoryService (tests). */
  agentDir?: string;
}

/**
 * Best-effort pre_compact LTM observe. Never throws — compact path must proceed.
 * Skips when LTM disabled or observePreCompact is false.
 */
export async function safeLtmPreCompactObserve(
  input: PreCompactObserveInput
): Promise<void> {
  try {
    const service = getMemoryService(input.agentDir);
    const config = service.getConfig();
    if (!config.enabled || !config.observePreCompact) return;

    const { title, narrative } = buildPreCompactObservation({
      messagesText: input.messagesText,
    });

    await service.observeFromCwd(input.cwd, {
      sessionId: input.sessionId,
      kind: "pre_compact",
      title,
      narrative,
    });
  } catch (err) {
    console.error("ltm pre_compact observe failed:", err);
  }
}

export interface AgentEndObserveInput {
  sessionId: string;
  cwd: string;
  userText: string;
  assistantText: string;
  /** Optional: force agentDir for getMemoryService (tests). */
  agentDir?: string;
}

/**
 * Best-effort agent_end LTM observe. Never throws — event path must proceed.
 * Skips when LTM disabled or observeAgentEnd is false.
 */
export async function safeLtmAgentEndObserve(
  input: AgentEndObserveInput
): Promise<void> {
  try {
    const service = getMemoryService(input.agentDir);
    const config = service.getConfig();
    if (!config.enabled || !config.observeAgentEnd) return;

    const { title, narrative } = buildAgentEndObservation({
      userText: input.userText,
      assistantText: input.assistantText,
    });

    await service.observeFromCwd(input.cwd, {
      sessionId: input.sessionId,
      kind: "agent_end",
      title,
      narrative,
    });
  } catch (err) {
    console.error("ltm agent_end observe failed:", err);
  }
}
