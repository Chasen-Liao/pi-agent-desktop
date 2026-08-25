import type { AgentMessage, AssistantMessage } from "./types";

export function splitActiveThinking(streamingMessage: Partial<AgentMessage> | null) {
  if (!streamingMessage || streamingMessage.role !== "assistant") {
    return { activeThinking: "", visibleStreamingMessage: streamingMessage };
  }

  const content = (streamingMessage as Partial<AssistantMessage>).content ?? [];
  const activeThinking = content
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking)
    .join("\n\n");
  const visibleContent = content.filter((block) => block.type !== "thinking");
  const visibleStreamingMessage = visibleContent.length > 0
    ? ({ ...streamingMessage, content: visibleContent } as Partial<AgentMessage>)
    : null;

  return { activeThinking, visibleStreamingMessage };
}
