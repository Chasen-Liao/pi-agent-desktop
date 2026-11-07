/** Returns true when streaming transcript updates should auto-scroll to keep the view pinned to the bottom. */
export function shouldFollowStreamingUpdate(input: {
  agentRunning: boolean;
  isAtBottom: boolean;
  followStreaming: boolean;
}): boolean {
  return input.followStreaming && input.agentRunning && input.isAtBottom;
}

/** Returns true when the chat view should smoothly scroll to the bottom after an agent run settles. */
export function shouldFollowAgentSettle(input: {
  agentRunning: boolean;
  initialScrollDone: boolean;
  isAtBottom: boolean;
  followStreaming: boolean;
}): boolean {
  return (
    input.followStreaming &&
    !input.agentRunning &&
    input.initialScrollDone &&
    input.isAtBottom
  );
}
