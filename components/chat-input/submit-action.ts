export type ComposerSubmitAction = "send" | "steer" | "followup" | "slash" | "none";

interface ComposerSubmitContext {
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
  isStreaming: boolean;
  slashMenuOpen: boolean;
  canSteer: boolean;
  canFollowUp: boolean;
}

export function resolveComposerSubmitAction({
  altKey,
  shiftKey,
  isComposing,
  isStreaming,
  slashMenuOpen,
  canSteer,
  canFollowUp,
}: ComposerSubmitContext): ComposerSubmitAction {
  if (shiftKey || isComposing) return "none";
  if (isStreaming && altKey && canFollowUp) return "followup";
  if (slashMenuOpen) return "slash";
  if (isStreaming && canSteer) return "steer";
  if (isStreaming && canFollowUp) return "followup";
  return "send";
}
