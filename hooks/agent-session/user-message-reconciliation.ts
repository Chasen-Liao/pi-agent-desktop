import type { AgentMessage, UserMessage } from "../../lib/types.ts";

export function reconcilePendingUserMessage(
  messages: AgentMessage[],
  canonical: UserMessage,
  clientMessageId: string
): { reconciled: boolean; messages: AgentMessage[] } {
  const index = messages.findIndex(
    (message) => message.role === "user" && message.clientMessageId === clientMessageId
  );
  if (index === -1) return { reconciled: false, messages };

  const pending = messages[index] as UserMessage;
  const reconciled = [...messages];
  reconciled[index] = { ...canonical, timestamp: pending.timestamp };
  return { reconciled: true, messages: reconciled };
}

export function reconcileOrAppendPendingUserMessage(
  messages: AgentMessage[],
  canonical: UserMessage,
  clientMessageId: string
): AgentMessage[] {
  const reconciliation = reconcilePendingUserMessage(messages, canonical, clientMessageId);
  return reconciliation.reconciled
    ? reconciliation.messages
    : [...messages, canonical];
}
