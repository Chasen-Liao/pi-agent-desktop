import { buildPreCompactObservation } from "./observe-payload.ts";
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
