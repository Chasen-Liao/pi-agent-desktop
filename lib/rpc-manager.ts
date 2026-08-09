import { existsSync } from "fs";
import { unlink } from "fs/promises";
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { cacheSessionPath, invalidateSessionPathCache } from "./session-reader.ts";
import type { AgentSessionLike, ToolInfo } from "./pi-types";
import {
  DEFAULT_AGENT_MODE,
  DEFAULT_TOOL_PRESET,
  effectiveToolsForMode,
  isAgentMode,
  isToolPreset,
  type AgentMode,
  type ToolPreset,
  toolNamesForPreset,
} from "./approval-policy.ts";
import { ExtensionUiBridge } from "./extension-ui-bridge.ts";
import { desktopApprovalInlineExtension, type AgentModeRef } from "./desktop-approval-extension.ts";
import {
  desktopLtmInlineExtension,
  withMemoryTools,
} from "./desktop-ltm-extension.ts";
import { readDesktopSettings } from "./desktop-settings.ts";
import { findLastAgentMode } from "./agent-mode-persistence.ts";
import {
  branchEntriesToMessagesText,
  lastAssistantFromBranch,
  lastUserFromBranch,
  safeLtmAgentEndObserve,
  safeLtmPreCompactObserve,
} from "./ltm/observe-hooks.ts";

// ============================================================================
// Constants
// ============================================================================

// Thinking format identifier used by pi's deepseek compat layer (reasoningEffortMap
// maps xhigh→max for this format). Centralized as a constant so a pi-side rename
// only requires editing one location instead of hunting string literals.
// Tracked for upstream removal — see AgentSessionWrapper.applyDeepSeekXhighWorkaround.
const DEEPSEEK_THINKING_FORMAT = "deepseek";

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallbacks: Array<() => void> = [];
  private _alive = true;
  private _agentMode: AgentMode = DEFAULT_AGENT_MODE;
  private _toolPreset: ToolPreset = DEFAULT_TOOL_PRESET;
  private _toolPresetBeforePlan: ToolPreset | null = null;
  private _modeRef: AgentModeRef = { current: DEFAULT_AGENT_MODE };
  private _uiBridge: ExtensionUiBridge | null = null;

  readonly inner: AgentSessionLike;

  constructor(inner: AgentSessionLike, options?: { modeRef?: AgentModeRef }) {
    this.inner = inner;
    if (options?.modeRef) {
      this._modeRef = options.modeRef;
      this._agentMode = options.modeRef.current;
    }
  }

  get agentMode(): AgentMode {
    return this._agentMode;
  }

  get toolPreset(): ToolPreset {
    return this._toolPreset;
  }

  /** Emit a synthetic event to SSE subscribers (extension UI, errors). */
  emitEvent(event: AgentEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        console.error("Error in event listener:", err);
      }
    }
  }

  attachUiBridge(bridge: ExtensionUiBridge): void {
    this._uiBridge = bridge;
  }

  get modeRef(): AgentModeRef {
    return this._modeRef;
  }

  initPolicy(mode: AgentMode, preset: ToolPreset): void {
    this._agentMode = mode;
    this._toolPreset = preset;
    this._modeRef.current = mode;
    if (mode === "plan") {
      this._toolPresetBeforePlan = preset;
    }
  }

  applyAgentMode(mode: AgentMode): void {
    if (mode === "plan" && this._agentMode !== "plan") {
      this._toolPresetBeforePlan = this._toolPreset;
    }
    if (mode !== "plan" && this._agentMode === "plan" && this._toolPresetBeforePlan) {
      this._toolPreset = this._toolPresetBeforePlan;
      this._toolPresetBeforePlan = null;
    }
    this._agentMode = mode;
    this._modeRef.current = mode;
    const tools = withMemoryTools(effectiveToolsForMode(mode, this._toolPreset), mode);
    this.inner.setActiveToolsByName(tools);
    if (tools.length === 0) {
      const state = this.inner.agent?.state as { systemPrompt?: string } | undefined;
      if (state) state.systemPrompt = "";
    }
  }
  setAgentMode(mode: AgentMode): void {
    if (!isAgentMode(mode)) throw new Error(`Invalid agent mode: ${String(mode)}`);
    this.applyAgentMode(mode);
    if (this.inner.sessionManager && typeof this.inner.sessionManager.appendCustomEntry === "function") {
      this.inner.sessionManager.appendCustomEntry("desktop_agent_mode", { mode });
    }
  }

  /** Infer preset from tool name list when client calls set_tools. */
  private inferPresetFromTools(names: string[]): ToolPreset {
    const key = [...names].sort().join(",");
    if (key === "") return "none";
    if (key === [...toolNamesForPreset("default")].sort().join(",")) return "default";
    if (key === [...toolNamesForPreset("full")].sort().join(",")) return "full";
    return "default";
  }

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  isAlive(): boolean {
    return this._alive;
  }

  start(): void {
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      this.resetIdleTimer();
      // Best-effort LTM observe when an agent loop settles.
      if (event.type === "agent_end") {
        try {
          const source = Array.isArray(event.messages)
            ? (event.messages as unknown[])
            : (this.inner.sessionManager.getBranch() as unknown[]);
          void safeLtmAgentEndObserve({
            sessionId: this.sessionId,
            cwd: this.inner.sessionManager.getHeader()?.cwd ?? process.cwd(),
            userText: lastUserFromBranch(source),
            assistantText: lastAssistantFromBranch(source),
          });
        } catch (err) {
          console.error("ltm agent_end observe wire failed:", err);
        }
      }
      for (const l of this.listeners) {
        try {
          l(event);
        } catch (err) {
          // One throwing listener (e.g. an SSE encoder whose stream died) must
          // not prevent the others from receiving the event, nor escape into
          // pi's subscribe callback and break the in-flight agent loop.
          console.error("Error in agent event listener:", err);
        }
      }
    });
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.destroy().catch((err) => console.error("Error during idle destroy:", err));
    }, 10 * 60 * 1000);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  /**
   * Emit an agent_error event to all listeners (SSE subscribers).
   * Used to surface pi-side prompt/steer/followUp failures to the client,
   * so the UI can reset agentRunning/agentPhase instead of hanging waiting
   * for an agent_end that will never come.
   *
   * Each listener is invoked inside try/catch so one throwing listener
   * does not prevent the others from receiving the event.
   *
   * NOTE: the message is currently passed through as-is. A sanitization
   * step (stripping paths / credentials) can be added later.
   */
  private emitAgentError(message: string): void {
    for (const l of this.listeners) {
      try {
        l({ type: "agent_error", errorMessage: message });
      } catch (err) {
        console.error("Error in agent_error listener:", err);
      }
    }
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallbacks.push(cb);
  }

  /**
   * Signal that this wrapper is still in use (e.g., SSE heartbeat).
   * Resets the idle timer without emitting any events.
   * No-op if the wrapper is already destroyed.
   */
  keepAlive(): void {
    if (!this._alive) return;
    this.resetIdleTimer();
  }

  /**
   * Build the current state snapshot. Shared by `send({ type: "get_state" })`
   * (which resets the idle timer, since the caller is actively driving the
   * session) and `peekState()` (which does not, since the caller is only
   * observing).
   */
  private buildStateSnapshot(): Record<string, unknown> {
    const model = this.inner.model;
    const contextUsage = this.inner.getContextUsage();
    return {
      sessionId: this.inner.sessionId,
      sessionFile: this.inner.sessionFile ?? "",
      isStreaming: this.inner.isStreaming,
      isCompacting: this.inner.isCompacting,
      autoCompactionEnabled: this.inner.autoCompactionEnabled,
      autoRetryEnabled: this.inner.autoRetryEnabled,
      model: model ? { id: model.id, provider: model.provider } : undefined,
      messageCount: 0,
      pendingMessageCount: 0,
      contextUsage: contextUsage
        ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
        : null,
      systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
      thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
      agentMode: this._agentMode,
      toolPreset: this._toolPreset,
      pendingUiRequestCount: this._uiBridge?.pendingCount ?? 0,
    };
  }

  /**
   * Read-only state snapshot. Returns the same payload as
   * `send({ type: "get_state" })` but does NOT reset the idle timer.
   *
   * Use this from observation endpoints (e.g.
   * `GET /api/sessions/[id]?includeState=1`) so that polling clients —
   * sidebar refreshes, stats panels — don't accidentally keep idle sessions
   * alive forever and prevent the 10-minute idle reclamation. Callers that
   * are intentionally driving the session should still use
   * `send({ type: "get_state" })`.
   */
  peekState(): Record<string, unknown> {
    return this.buildStateSnapshot();
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;

    switch (type) {
      case "prompt": {
        // Server-side backstop: the UI disables the send button while
        // streaming, but a racing / double-fired prompt (double-click, retry
        // after a dropped agent_end) must not start a second agent loop in
        // parallel with the in-flight one. Reject deterministically here
        // instead of relying on pi's internal isStreaming handling.
        if (this.inner.isStreaming) throw new Error("Session is streaming");
        // Fire and forget — events come via subscribe
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        this.inner.prompt(command.message as string, promptImages?.length ? { images: promptImages } : undefined)
          .catch((err) => {
            console.error("pi prompt failed:", err);
            this.emitAgentError(err instanceof Error ? err.message : String(err));
          });
        return null;
      }

      case "abort":
        await this.inner.abort();
        return null;

      case "get_state": {
        return this.buildStateSnapshot();
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        const model = this.inner.modelRuntime.getModel(provider, modelId);
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        // Refuse to fork while the session is actively streaming: the branch
        // copy below reads the .jsonl up to the fork point, which is unsafe
        // mid-write (a half-appended line), and the trailing this.destroy()
        // would abort the running loop mid-turn. The UI disables fork while
        // streaming; this is the deterministic server-side backstop.
        if (this.inner.isStreaming) throw new Error("Session is streaming");
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        // Guard: refuse to fork if the underlying session file has been deleted
        // (e.g., a concurrent DELETE racing with this fork — see Task D4).
        // isPersisted() reflects in-memory state and may still return true while
        // the file is already gone; without this check, SessionManager.open()
        // below would throw, or — worse — createBranchedSession would produce a
        // new .jsonl whose parentSession references a dead path. existsSync is a
        // synchronous stat; acceptable here because fork is already an async,
        // user-initiated, infrequent operation.
        if (!existsSync(currentSessionFile)) return { cancelled: true };

        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }

        const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);

        // Pre-register the new wrapper BEFORE destroying the old.
        // Contract: by the time send() returns, newSessionId is in the registry.
        // If startRpcSession throws, do NOT destroy — old wrapper stays usable under the old id.
        // The orphaned new .jsonl file is cleaned up in the catch below (its name is a unique
        // <timestamp>_<uuid>.jsonl, so it would never be overwritten by future forks).
        const newCwd = sessionManager.getHeader()?.cwd ?? process.cwd();
        try {
          await startRpcSession(newSessionId, newSessionFile, newCwd);
        } catch (err) {
          // startRpcSession failed: clean up the orphan .jsonl file (it uses a unique
          // <timestamp>_<uuid>.jsonl name, so it would never be overwritten by future forks).
          // The cached path is also invalidated so future lookups don't find a dead entry.
          invalidateSessionPathCache(newSessionId);
          await unlink(newSessionFile).catch(() => { /* best-effort: file may not exist */ });
          throw err;
        }

        await this.destroy();
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // For deepseek compat models, force xhigh back so the compat layer works.
        // See applyDeepSeekXhighWorkaround for details and upstream tracking.
        this.applyDeepSeekXhighWorkaround(level);
        return null;
      }

      case "compact": {
        // Refuse to compact while streaming: the pre-check reads
        // sessionManager.getBranch() (possibly mid-write) and pi's compact()
        // aborts the running loop as a side effect. The UI hides the compact
        // button while streaming; this is the server-side backstop.
        if (this.inner.isStreaming) throw new Error("Session is streaming");
        // pi's compact() does not guard against empty messagesToSummarize — use findCutPoint
        // to pre-check and throw a clean error instead of generating a useless empty summary.
        const { findCutPoint, DEFAULT_COMPACTION_SETTINGS } = await import("@earendil-works/pi-coding-agent");
        const pathEntries = this.inner.sessionManager.getBranch() as Array<{ type: string }>;
        const settings = { ...DEFAULT_COMPACTION_SETTINGS, ...this.inner.settingsManager.getCompactionSettings() };
        let prevCompactionIndex = -1;
        for (let i = pathEntries.length - 1; i >= 0; i--) {
          if (pathEntries[i].type === "compaction") { prevCompactionIndex = i; break; }
        }
        const boundaryStart = prevCompactionIndex + 1;
        const cutPoint = findCutPoint(pathEntries as never, boundaryStart, pathEntries.length, settings.keepRecentTokens);
        const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;
        if (historyEnd <= boundaryStart) {
          throw new Error("Conversation too short to compact");
        }
        // Best-effort LTM observe of branch text before compaction rewrites context.
        void safeLtmPreCompactObserve({
          sessionId: this.sessionId,
          cwd: this.inner.sessionManager.getHeader()?.cwd ?? process.cwd(),
          messagesText: branchEntriesToMessagesText(pathEntries),
        });
        const result = await this.inner.compact(command.customInstructions as string | undefined);
        return result;
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        try {
          await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        } catch (err) {
          console.error("pi steer failed:", err);
          this.emitAgentError(err instanceof Error ? err.message : String(err));
          throw err;
        }
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        try {
          await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        } catch (err) {
          console.error("pi followUp failed:", err);
          this.emitAgentError(err instanceof Error ? err.message : String(err));
          throw err;
        }
        return null;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
        }));
      }

      case "set_tools": {
        const toolNames = (command.toolNames as string[]) ?? [];
        this._toolPreset = this.inferPresetFromTools(toolNames);
        if (this._agentMode === "plan") {
          this._toolPresetBeforePlan = this._toolPreset;
          this.inner.setActiveToolsByName(
            withMemoryTools([...effectiveToolsForMode("plan", this._toolPreset)], "plan")
          );
        } else {
          this.inner.setActiveToolsByName(withMemoryTools(toolNames, this._agentMode));
        }
        return null;
      }

      case "set_agent_mode": {
        const mode = command.mode;
        if (!isAgentMode(mode)) throw new Error(`Invalid agent mode: ${String(mode)}`);
        this.setAgentMode(mode);
        return { agentMode: this._agentMode, toolPreset: this._toolPreset };
      }

      case "extension_ui_response": {
        if (!this._uiBridge) throw new Error("No extension UI bridge");
        const id = command.id as string;
        if (typeof id !== "string" || !id) throw new Error("extension_ui_response requires id");
        const err = this._uiBridge.respond({
          id,
          confirmed: command.confirmed as boolean | undefined,
          value: command.value as string | undefined,
          cancelled: command.cancelled as boolean | undefined,
        });
        if (err) throw new Error(err);
        return null;
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  /**
   * Workaround for DeepSeek thinking format compat: pi's setThinkingLevel clamps
   * xhigh→high when supportsXhigh()===false, but for models with deepseek thinking
   * format, the compat layer (reasoningEffortMap maps xhigh→max) needs the raw
   * xhigh value. Force the state back.
   *
   * This hack is isolated here (not inlined in set_thinking_level case) so it's
   * easy to remove once pi's setThinkingLevel handles compat internally.
   * Tracked in upstream pi issue (TODO: link).
   *
   * Once pi's setThinkingLevel handles compat internally, remove this method
   * and the call site in the set_thinking_level case above.
   *
   * @returns true if the workaround was applied, false otherwise.
   */
  private applyDeepSeekXhighWorkaround(level: string): boolean {
    if (level !== "xhigh") return false;
    const model = this.inner.model as { compat?: { thinkingFormat?: string } } | null;
    if (model?.compat?.thinkingFormat !== DEEPSEEK_THINKING_FORMAT) return false;
    const state = this.inner.agent?.state as { thinkingLevel?: string } | undefined;
    if (!state) return false;
    state.thinkingLevel = "xhigh";
    return true;
  }

  async destroy(): Promise<void> {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    // Unsubscribe BEFORE aborting. abort() emits terminal events (agent_end,
    // agent_error, …) as it tears down the loop; with the SSE listener still
    // attached, those would be delivered to a stream that is about to close
    // (previously papered over by the per-listener try/catch, M2). Detaching
    // first shrinks that delivery window to ~zero.
    // Await unsubscribe in case pi's subscribe() returns an async cleanup fn
    // in the future. Current type is `() => void` (sync) — awaiting a void
    // expression is a no-op but future-proof.
    try {
      await this.unsubscribe?.();
    } catch (err) {
      console.error("Error during unsubscribe:", err);
    }
    // Terminate the inner pi agent loop. Without this, a forked/deleted
    // session keeps running and writing its .jsonl (snapshot after fork is
    // lost; DELETE fails on Windows with EPERM because the file is open), and
    // stale wrappers accumulate live AgentSessions holding runtime resources.
    // Best-effort: abort() is a no-op when the loop is already idle.
    try {
      await this.inner.abort();
    } catch (err) {
      console.error("Error aborting inner agent session:", err);
    }
    try {
      this._uiBridge?.destroy();
    } catch (err) {
      console.error("Error destroying UI bridge:", err);
    }
    this._uiBridge = null;
    for (const cb of this.onDestroyCallbacks) {
      try {
        await cb();
      } catch (err) {
        console.error("Error in onDestroy callback:", err);
      }
    }
    this.onDestroyCallbacks = [];
  }
}

// ============================================================================
// Session registry
// ============================================================================

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
  var __piSessionOnlyTrust: Map<string, boolean> | undefined;
}

export function getSessionOnlyTrustMap(): Map<string, boolean> {
  if (!globalThis.__piSessionOnlyTrust) globalThis.__piSessionOnlyTrust = new Map();
  return globalThis.__piSessionOnlyTrust;
}

export type StartRpcSessionOptions = {
  toolNames?: string[];
  agentMode?: AgentMode;
  toolPreset?: ToolPreset;
};

function normalizeStartOptions(
  toolNamesOrOpts?: string[] | StartRpcSessionOptions
): StartRpcSessionOptions {
  if (Array.isArray(toolNamesOrOpts)) return { toolNames: toolNamesOrOpts };
  return toolNamesOrOpts ?? {};
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    // The 'exit' event cannot await (the process is already tearing down), so
    // per-wrapper destroy stays fire-and-forget here.
    const exitCleanup = () => {
      globalThis.__piSessions?.forEach((s) => {
        s.destroy().catch((err) => console.error("Error during exit destroy:", err));
      });
    };
    // SIGINT/SIGTERM handlers CAN await: drain every wrapper's destroy() before
    // the process exits, so the final batch of .jsonl writes is not lost to a
    // fire-and-forget destroy. destroy() never rejects (every step is wrapped),
    // allSettled is belt-and-suspenders. Conventional signal exit codes are
    // preserved (128 + signal).
    const gracefulCleanup = async (signal: string) => {
      const sessions = globalThis.__piSessions ? [...globalThis.__piSessions.values()] : [];
      await Promise.allSettled(sessions.map((s) => s.destroy()));
      process.exit(signal === "SIGINT" ? 130 : 143);
    };
    process.once("exit", exitCleanup);
    process.once("SIGINT", () => { void gracefulCleanup("SIGINT"); });
    process.once("SIGTERM", () => { void gracefulCleanup("SIGTERM"); });
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNamesOrOpts?: string[] | StartRpcSessionOptions
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();
  const opts = normalizeStartOptions(toolNamesOrOpts);

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = (async () => {
    const {
      SessionManager,
      getAgentDir,
      DefaultResourceLoader,
    } = await import("@earendil-works/pi-coding-agent");
    const agentDir = getAgentDir();
    const desktop = readDesktopSettings(agentDir);

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd, undefined);

    const storedMode = findLastAgentMode(sessionManager.getEntries() as never);
    const agentMode: AgentMode = isAgentMode(opts.agentMode)
      ? opts.agentMode
      : (storedMode ?? desktop.defaultAgentMode);
    let toolPreset: ToolPreset = isToolPreset(opts.toolPreset)
      ? opts.toolPreset
      : desktop.defaultToolPreset;

    // If caller passed explicit toolNames (legacy), infer preset when possible.
    if (opts.toolNames && !opts.toolPreset) {
      const key = [...opts.toolNames].sort().join(",");
      if (key === "") toolPreset = "none";
      else if (key === [...toolNamesForPreset("default")].sort().join(",")) toolPreset = "default";
      else if (key === [...toolNamesForPreset("full")].sort().join(",")) toolPreset = "full";
    }

    const effectiveTools = withMemoryTools(
      effectiveToolsForMode(agentMode, toolPreset),
      agentMode
    );

    const modeRef: AgentModeRef = { current: agentMode };
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      extensionFactories: [
        desktopApprovalInlineExtension(modeRef),
        desktopLtmInlineExtension({ getCwd: () => cwd }),
      ],
    });
    await resourceLoader.reload();

    // Pi 0.82+: empty tools allowlist is expressed via noTools: "all"
    const createOptions =
      effectiveTools.length === 0 ? { noTools: "all" as const } : { tools: effectiveTools };

    const { session: inner } = await createAgentSession({
      cwd,
      agentDir,
      sessionManager,
      resourceLoader,
      ...createOptions,
    });

    if (effectiveTools.length > 0) {
      inner.setActiveToolsByName(effectiveTools);
    }

    // When all tools are disabled, clear the system prompt entirely.
    // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
    // the only way to truly clear it is to call agent.setSystemPrompt directly.
    if (effectiveTools.length === 0) {
      inner.agent.state.systemPrompt = "";
    }

    // AgentSession is structurally compatible with AgentSessionLike; cast keeps
    // our thin facade free of full ExtensionUIContext coupling.
    const wrapper = new AgentSessionWrapper(inner as unknown as AgentSessionLike, { modeRef });
    wrapper.initPolicy(agentMode, toolPreset);

    const bridge = new ExtensionUiBridge((event) => {
      wrapper.emitEvent(event);
    });
    wrapper.attachUiBridge(bridge);

    if (typeof inner.bindExtensions === "function") {
      await inner.bindExtensions({
        uiContext: bridge as unknown as Parameters<NonNullable<AgentSessionLike["bindExtensions"]>>[0]["uiContext"],
        mode: "rpc",
      });
    }

    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    // Ownership guard on the registry delete: destroy() is async and only runs
    // onDestroy callbacks after awaiting abort/unsubscribe, so a NEWER wrapper
    // started for the same id during that window can already be registered
    // here. An unconditional delete would evict the live wrapper (P2-4).
    wrapper.onDestroy(() => {
      if (registry.get(realSessionId) === wrapper) registry.delete(realSessionId);
    });
    registry.set(realSessionId, wrapper);

    return { session: wrapper, realSessionId };
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}
