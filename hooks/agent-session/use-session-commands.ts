"use client";

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { AgentMessage, SessionInfo, CustomMessage, Skill, UserMessage } from "@/lib/types";
import { sendAgentCommand } from "@/lib/agent-client";
import type { FollowUpQueueSnapshot } from "@/lib/follow-up-queue";
import type { StreamAction } from "./stream-state";
import type { AgentPhase } from "./agent-phase";
import type { ThinkingLevelOption } from "./session-lifecycle-reset";
import type { AgentMode } from "@/lib/approval-policy";
import { EXECUTE_PLAN_PROMPT } from "@/lib/approval-policy";
import { ensureTrustThenFetch } from "@/lib/trust-fetch";
import type { NeedsTrustPayload } from "@/lib/trust-types";

export type AttachedImage = {
  data: string;
  mimeType: string;
  previewUrl: string;
};

export type UseSessionCommandsOptions = {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  isNew: boolean;
  agentRunning: boolean;
  isCompacting: boolean;
  toolPreset: "none" | "default" | "full";
  agentMode: AgentMode;
  setAgentMode: (mode: AgentMode) => void;
  thinkingLevel: ThinkingLevelOption;
  newSessionModel: { provider: string; modelId: string } | null;
  sessionIdRef: MutableRefObject<string | null>;
  pendingScrollToUserRef: MutableRefObject<boolean>;
  setMessages: Dispatch<SetStateAction<AgentMessage[]>>;
  setAgentRunning: (v: boolean) => void;
  setAgentPhase: Dispatch<SetStateAction<AgentPhase>>;
  dispatch: Dispatch<StreamAction>;
  setPendingModel: (m: { provider: string; modelId: string } | null) => void;
  setIsCompacting: (v: boolean) => void;
  setCompactError: (v: string | null) => void;
  setForkingEntryId: (v: string | null) => void;
  setActiveLeafId: (v: string | null) => void;
  setCanExecutePlan: (v: boolean) => void;
  promptTrust: (payload: NeedsTrustPayload) => Promise<string | null>;
  loadSession: (sid: string, showLoading?: boolean, includeState?: boolean) => Promise<unknown>;
  loadContext: (sid: string, leafId: string) => Promise<unknown>;
  connectEvents: (sid: string) => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  onFollowUpQueueSnapshot: (snapshot: FollowUpQueueSnapshot) => void;
  onPendingSteerQueued: (item: { id: string; message: string }) => void;
  onPendingSteerFailed: (id: string) => void;
};

export function useSessionCommands(opts: UseSessionCommandsOptions) {
  const {
    session,
    newSessionCwd,
    isNew,
    agentRunning,
    isCompacting,
    toolPreset,
    agentMode,
    setAgentMode,
    thinkingLevel,
    newSessionModel,
    sessionIdRef,
    pendingScrollToUserRef,
    setMessages,
    setAgentRunning,
    setAgentPhase,
    dispatch,
    setPendingModel,
    setIsCompacting,
    setCompactError,
    setForkingEntryId,
    setActiveLeafId,
    setCanExecutePlan,
    promptTrust,
    loadSession,
    loadContext,
    connectEvents,
    onSessionCreated,
    onSessionForked,
    onFollowUpQueueSnapshot,
    onPendingSteerQueued,
    onPendingSteerFailed,
  } = opts;

  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isCompacting) return;
    setIsCompacting(true);
    setCompactError(null);
    try {
      await sendAgentCommand(sid, { type: "compact" });
      await loadSession(sid, true);
    } catch (e) {
      setCompactError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsCompacting(false);
    }
  }, [isCompacting, loadSession, sessionIdRef, setCompactError, setIsCompacting]);

  const handleSend = useCallback(
    async (message: string, images?: AttachedImage[]) => {
      const msgTrimmed = message.trim();
      if (!msgTrimmed && !images?.length) return;
      if (agentRunning) return;

      if (!images?.length && msgTrimmed.startsWith("/")) {
        const parts = msgTrimmed.slice(1).split(/\s+/);
        const cmd = parts[0].toLowerCase();
        let handled = false;
        switch (cmd) {
          case "compact":
            handleCompact();
            handled = true;
            break;
          case "tools":
            setMessages((prev) => [
              ...prev,
              {
                role: "custom",
                customType: "tools_info",
                content: `### Tool Presets\n\n- **Off**: No tools\n- **Low**: \`read\`, \`bash\`, \`edit\`, \`write\`\n- **High**: \`read\`, \`bash\`, \`edit\`, \`write\`, \`grep\`, \`find\`, \`ls\`\n\n*Note: To change tool presets, use the **Tools** button in the chat input.*`,
                display: true,
                timestamp: Date.now(),
              } as CustomMessage,
            ]);
            handled = true;
            break;
          case "skills": {
            const cwd = newSessionCwd ?? session?.cwd ?? "";
            fetch(`/api/skills?cwd=${encodeURIComponent(cwd)}`)
              .then((res) => res.json())
              .then((d) => {
                if (d.error) {
                  setMessages((prev) => [
                    ...prev,
                    {
                      role: "custom",
                      customType: "skills_error",
                      content: `Failed to load skills: ${d.error}`,
                      display: true,
                      timestamp: Date.now(),
                    } as CustomMessage,
                  ]);
                  return;
                }
                const skillsList =
                  d.skills
                    ?.map(
                      (s: Skill) =>
                        `- **\`${s.name}\`**: ${s.description || "No description"}`
                    )
                    .join("\n") || "No skills found.";
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "custom",
                    customType: "skills_info",
                    content: `### Available Skills\n\n${skillsList}\n\n*Note: To install new skills, use the **Skills** button in the sidebar.*`,
                    display: true,
                    timestamp: Date.now(),
                  } as CustomMessage,
                ]);
              })
              .catch((e) => console.error("Failed to fetch skills:", e));
            handled = true;
            break;
          }
        }
        if (handled) return;
      }

      const imageBlocks = images?.map((img) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: img.mimeType, data: img.data },
      }));
      const userMsg: AgentMessage = {
        role: "user",
        content: imageBlocks?.length
          ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks]
          : message,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setAgentRunning(true);
      setAgentPhase({ kind: "waiting_model" });
      dispatch({ type: "start" });
      pendingScrollToUserRef.current = true;

      const piImages = images?.map((img) => ({
        type: "image" as const,
        data: img.data,
        mimeType: img.mimeType,
      }));

      try {
        if (isNew && newSessionCwd) {
          const selectedModel = newSessionModel;
          if (selectedModel) setPendingModel(selectedModel);
          const { PRESET_NONE, PRESET_DEFAULT, PRESET_FULL } = await import(
            "@/components/ToolPanel"
          );
          const toolNames =
            toolPreset === "none"
              ? PRESET_NONE
              : toolPreset === "default"
                ? PRESET_DEFAULT
                : PRESET_FULL;
          const res = await ensureTrustThenFetch(
            "/api/agent/new",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                cwd: newSessionCwd,
                type: "prompt",
                message,
                toolNames,
                agentMode,
                toolPreset,
                ...(piImages?.length ? { images: piImages } : {}),
                ...(selectedModel
                  ? { provider: selectedModel.provider, modelId: selectedModel.modelId }
                  : {}),
                ...(thinkingLevel !== "auto" ? { thinkingLevel } : {}),
              }),
            },
            promptTrust
          );
          if (!res.ok) {
            let errMsg = `HTTP ${res.status}`;
            try {
              const j = (await res.json()) as { error?: string };
              if (j.error) errMsg = j.error;
            } catch { /* ignore */ }
            throw new Error(errMsg);
          }
          const result = (await res.json()) as { sessionId: string };
          const realId = result.sessionId;
          sessionIdRef.current = realId;
          connectEvents(realId);
          onSessionCreated?.({
            id: realId,
            path: "",
            cwd: newSessionCwd,
            name: undefined,
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            messageCount: 1,
            firstMessage: message,
          });
        } else if (session) {
          connectEvents(session.id);
          await sendAgentCommand(session.id, {
            type: "prompt",
            message,
            ...(piImages?.length ? { images: piImages } : {}),
          });
        }
      } catch (e) {
        console.error("Failed to send message:", e);
        setAgentRunning(false);
        setAgentPhase(null);
        dispatch({ type: "end" });
      }
    },
    [
      isNew,
      newSessionCwd,
      newSessionModel,
      toolPreset,
      agentMode,
      thinkingLevel,
      session,
      agentRunning,
      connectEvents,
      onSessionCreated,
      pendingScrollToUserRef,
      setMessages,
      handleCompact,
      setAgentRunning,
      setAgentPhase,
      dispatch,
      setPendingModel,
      sessionIdRef,
      promptTrust,
    ]
  );

  const handleAgentModeChange = useCallback(
    async (mode: AgentMode) => {
      const prevMode = agentMode;
      // Optimistic update; roll back to the previous mode if the server call
      // fails so the UI never diverges from the server's agent mode.
      setAgentMode(mode);
      setCanExecutePlan(false);
      const sid = sessionIdRef.current;
      if (!sid || isNew) return;
      try {
        await sendAgentCommand(sid, { type: "set_agent_mode", mode });
      } catch (e) {
        console.error("Failed to set agent mode:", e);
        setAgentMode(prevMode);
      }
    },
    [agentMode, isNew, sessionIdRef, setAgentMode, setCanExecutePlan]
  );

  const handleExecutePlan = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || agentRunning) return;
    setCanExecutePlan(false);
    setAgentMode("ask");
    try {
      await sendAgentCommand(sid, { type: "set_agent_mode", mode: "ask" });
    } catch (e) {
      console.error("Failed to switch to ask for execute plan:", e);
    }
    await handleSend(EXECUTE_PLAN_PROMPT);
  }, [agentRunning, handleSend, sessionIdRef, setAgentMode, setCanExecutePlan]);

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    // Optimistically reflect the abort so agentRunning isn't stuck true if the
    // agent_end SSE event is lost; roll back + reconnect if the abort command
    // itself fails.
    setAgentRunning(false);
    try {
      await sendAgentCommand(sid, { type: "abort" });
      // agentRunning=false tears down the SSE stream (see useAgentEvents), so
      // agent_end won't arrive — end streaming state now and reload the
      // transcript below to sync the final (aborted) message state.
      dispatch({ type: "end" });
      setAgentPhase(null);
    } catch (e) {
      console.error("Failed to abort:", e);
      setAgentRunning(true);
      connectEvents(sid);
      return;
    }
    // The abort succeeded. A reload failure (e.g. a network blip on the GET)
    // must NOT be treated as an abort failure — the agent is already stopped,
    // so restoring agentRunning here would leave it stuck true forever (no
    // agent_end will ever arrive).
    try {
      await loadSession(sid);
    } catch (e) {
      console.error("Failed to reload session after abort:", e);
    }
  }, [connectEvents, dispatch, loadSession, sessionIdRef, setAgentPhase, setAgentRunning]);

  const handleFork = useCallback(
    async (entryId: string) => {
      const sid = sessionIdRef.current;
      // entryId can be undefined/empty while a message is streaming (SSE events
      // don't carry the session entry id until the transcript is reloaded).
      // Never send an empty fork entryId to the server.
      if (!sid || !entryId) return;
      setForkingEntryId(entryId);
      try {
        const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sid, {
          type: "fork",
          entryId,
        });
        const { cancelled, newSessionId } = result ?? {};
        if (!cancelled && newSessionId) {
          onSessionForked?.(newSessionId);
        }
      } catch (e) {
        console.error("Fork failed:", e);
      } finally {
        setForkingEntryId(null);
      }
    },
    [onSessionForked, sessionIdRef, setForkingEntryId]
  );

  const navigateToLeaf = useCallback(
    async (leafId: string | null) => {
      if (!leafId) {
        setActiveLeafId(null);
        return;
      }
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        const result = await sendAgentCommand<{ cancelled?: boolean }>(sid, {
          type: "navigate_tree",
          targetId: leafId,
        });
        if (result?.cancelled) {
          console.warn("navigate_tree cancelled:", leafId);
          return;
        }
        setActiveLeafId(leafId);
        await loadContext(sid, leafId);
      } catch (e) {
        console.error("navigate_tree failed:", e);
      }
    },
    [loadContext, setActiveLeafId, sessionIdRef]
  );

  const handleNavigate = useCallback(
    (entryId: string) => navigateToLeaf(entryId),
    [navigateToLeaf]
  );

  const handleLeafChange = useCallback(
    (leafId: string | null) => navigateToLeaf(leafId),
    [navigateToLeaf]
  );

  const handleSteer = useCallback(
    async (message: string, images?: AttachedImage[]) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const clientMessageId = globalThis.crypto.randomUUID();
      const imageBlocks = images?.map((img) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: img.mimeType, data: img.data },
      }));
      onPendingSteerQueued({ id: clientMessageId, message });
      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: imageBlocks?.length
            ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks]
            : message,
          timestamp: Date.now(),
          clientMessageId,
          deliveryState: "pending",
        } satisfies UserMessage,
      ]);
      const piImages = images?.map((img) => ({
        type: "image" as const,
        data: img.data,
        mimeType: img.mimeType,
      }));
      try {
        await sendAgentCommand(sid, {
          type: "steer",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
        });
      } catch (e) {
        console.error("Failed to steer:", e);
        onPendingSteerFailed(clientMessageId);
        throw e;
      }
    },
    [onPendingSteerFailed, onPendingSteerQueued, setMessages, sessionIdRef]
  );

  const handleFollowUp = useCallback(
    async (message: string, images?: AttachedImage[]) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const piImages = images?.map((img) => ({
        type: "image" as const,
        data: img.data,
        mimeType: img.mimeType,
      }));
      try {
        const snapshot = await sendAgentCommand<FollowUpQueueSnapshot>(sid, {
          type: "follow_up",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
        });
        onFollowUpQueueSnapshot(snapshot);
      } catch (e) {
        console.error("Failed to follow up:", e);
        throw e;
      }
    },
    [onFollowUpQueueSnapshot, sessionIdRef]
  );

  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort_compaction" });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
    }
  }, [sessionIdRef]);

  return {
    handleSend,
    handleAbort,
    handleFork,
    handleNavigate,
    handleLeafChange,
    handleCompact,
    handleSteer,
    handleFollowUp,
    handleAbortCompaction,
    handleAgentModeChange,
    handleExecutePlan,
  };
}
