"use client";

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { AgentMessage, SessionInfo, CustomMessage, Skill } from "@/lib/types";
import { sendAgentCommand } from "@/lib/agent-client";
import type { StreamAction } from "./stream-state";
import type { AgentPhase } from "./agent-phase";
import type { ThinkingLevelOption } from "./session-lifecycle-reset";

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
  loadSession: (sid: string, showLoading?: boolean, includeState?: boolean) => Promise<unknown>;
  loadContext: (sid: string, leafId: string) => Promise<unknown>;
  connectEvents: (sid: string) => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
};

export function useSessionCommands(opts: UseSessionCommandsOptions) {
  const {
    session,
    newSessionCwd,
    isNew,
    agentRunning,
    isCompacting,
    toolPreset,
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
    loadSession,
    loadContext,
    connectEvents,
    onSessionCreated,
    onSessionForked,
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
          const res = await fetch("/api/agent/new", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cwd: newSessionCwd,
              type: "prompt",
              message,
              toolNames,
              ...(piImages?.length ? { images: piImages } : {}),
              ...(selectedModel
                ? { provider: selectedModel.provider, modelId: selectedModel.modelId }
                : {}),
              ...(thinkingLevel !== "auto" ? { thinkingLevel } : {}),
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
    ]
  );

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, [sessionIdRef]);

  const handleFork = useCallback(
    async (entryId: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
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
      setMessages((prev) => [
        ...prev,
        { role: "user", content: `[steer] ${message}`, timestamp: Date.now() } as AgentMessage,
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
      }
    },
    [setMessages, sessionIdRef]
  );

  const handleFollowUp = useCallback(
    async (message: string, images?: AttachedImage[]) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      setMessages((prev) => [
        ...prev,
        { role: "user", content: message, timestamp: Date.now() } as AgentMessage,
      ]);
      const piImages = images?.map((img) => ({
        type: "image" as const,
        data: img.data,
        mimeType: img.mimeType,
      }));
      try {
        await sendAgentCommand(sid, {
          type: "follow_up",
          message,
          ...(piImages?.length ? { images: piImages } : {}),
        });
      } catch (e) {
        console.error("Failed to follow up:", e);
      }
    },
    [setMessages, sessionIdRef]
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
  };
}
