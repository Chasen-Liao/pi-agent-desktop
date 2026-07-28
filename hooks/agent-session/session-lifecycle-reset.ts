/**
 * Pure helpers for session-switch reset and applying loaded agent state.
 * Keeps the session-id effect in useAgentSession thin and testable.
 */

export type ThinkingLevelOption =
  | "auto"
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type SessionScopedResetPatch = {
  clearData: true;
  clearActiveLeafId: true;
  clearMessages: true;
  clearEntryIds: true;
  toolPreset: "default";
  thinkingLevel: "auto";
  agentRunning: false;
  agentPhase: null;
  streamReset: true;
  retryInfo: null;
  contextUsage: null;
  systemPrompt: null;
  forkingEntryId: null;
  isCompacting: false;
  compactError: null;
  currentModelOverride: null;
  pendingModel: null;
};

/** Values to apply when switching to another session id (bleed prevention). */
export function sessionScopedResetPatch(): SessionScopedResetPatch {
  return {
    clearData: true,
    clearActiveLeafId: true,
    clearMessages: true,
    clearEntryIds: true,
    toolPreset: "default",
    thinkingLevel: "auto",
    agentRunning: false,
    agentPhase: null,
    streamReset: true,
    retryInfo: null,
    contextUsage: null,
    systemPrompt: null,
    forkingEntryId: null,
    isCompacting: false,
    compactError: null,
    currentModelOverride: null,
    pendingModel: null,
  };
}

export type LoadedAgentStateInput = {
  agentState?: {
    running?: boolean;
    state?: {
      isStreaming?: boolean;
      isCompacting?: boolean;
      contextUsage?: {
        percent: number | null;
        contextWindow: number;
        tokens: number | null;
      } | null;
      systemPrompt?: string;
      thinkingLevel?: string;
    } | null;
  } | null;
  contextThinkingLevel?: string | null;
};

export type LoadedAgentStatePatch = {
  thinkingLevel?: ThinkingLevelOption;
  agentRunning?: boolean;
  agentPhaseWaitingModel?: boolean;
  connectEvents?: boolean;
  loadTools?: boolean;
  isCompacting?: boolean;
  contextUsage?: {
    percent: number | null;
    contextWindow: number;
    tokens: number | null;
  } | null;
  systemPrompt?: string | null;
};

/**
 * Derive UI patches from a session load payload (includeState path).
 */
export function loadedAgentStatePatch(input: LoadedAgentStateInput): LoadedAgentStatePatch {
  const patch: LoadedAgentStatePatch = {};
  const agentState = input.agentState ?? null;

  if (
    !agentState?.state?.thinkingLevel &&
    input.contextThinkingLevel &&
    input.contextThinkingLevel !== "off"
  ) {
    patch.thinkingLevel = input.contextThinkingLevel as ThinkingLevelOption;
  }

  if (agentState?.running) {
    patch.loadTools = true;
    if (agentState.state?.isStreaming) {
      patch.agentRunning = true;
      patch.agentPhaseWaitingModel = true;
      patch.connectEvents = true;
    }
  }

  if (agentState?.state) {
    if (agentState.state.isCompacting !== undefined) {
      patch.isCompacting = agentState.state.isCompacting;
    }
    if (agentState.state.contextUsage !== undefined) {
      patch.contextUsage = agentState.state.contextUsage ?? null;
    }
    if (agentState.state.systemPrompt !== undefined) {
      patch.systemPrompt = agentState.state.systemPrompt ?? null;
    }
    if (agentState.state.thinkingLevel !== undefined) {
      patch.thinkingLevel = (agentState.state.thinkingLevel as ThinkingLevelOption) ?? "auto";
    }
  }

  return patch;
}
