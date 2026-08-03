const TITLE_MAX = 80;
const USER_MAX = 500;
const ASSISTANT_MAX = 4000;
const PRE_COMPACT_MAX = 6000;
const EMPTY = "(empty)";

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

/** First line, truncated to TITLE_MAX; empty → "(empty)". */
function titleFromText(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? text;
  const clipped = truncate(line, TITLE_MAX);
  return clipped.length === 0 ? EMPTY : clipped;
}

function orEmpty(text: string): string {
  return text.length === 0 ? EMPTY : text;
}

/**
 * Zero-LLM payload for agent_end observe:
 * - title: first line / 80 chars of last user prompt
 * - narrative: User: (≤500) + Assistant: (≤4000)
 */
export function buildAgentEndObservation(input: {
  userText: string;
  assistantText: string;
}): { title: string; narrative: string } {
  const user = truncate(input.userText, USER_MAX);
  const assistant = truncate(input.assistantText, ASSISTANT_MAX);
  return {
    title: titleFromText(input.userText),
    narrative: `User: ${orEmpty(user)}\nAssistant: ${orEmpty(assistant)}`,
  };
}

/**
 * Zero-LLM payload for pre_compact observe:
 * - title: first line / 80 chars of messages text
 * - narrative: messages body truncated to 6000
 */
export function buildPreCompactObservation(input: {
  messagesText: string;
}): { title: string; narrative: string } {
  const body = truncate(input.messagesText, PRE_COMPACT_MAX);
  return {
    title: titleFromText(input.messagesText),
    narrative: orEmpty(body),
  };
}
