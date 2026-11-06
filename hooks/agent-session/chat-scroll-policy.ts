export function shouldFollowStreamingUpdate(input: {
  agentRunning: boolean;
  isAtBottom: boolean;
  followStreaming: boolean;
}): boolean {
  return input.followStreaming && input.agentRunning && input.isAtBottom;
}

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
