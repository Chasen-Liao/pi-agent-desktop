"use client";

import { useCallback, useEffect, useState } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import {
  getPresetFromTools,
  PRESET_NONE,
  PRESET_DEFAULT,
  PRESET_FULL,
  type ToolEntry,
} from "@/lib/tool-presets";
import type { ThinkingLevelOption } from "./session-lifecycle-reset";

type ModelListItem = { id: string; name: string; provider: string };

export type UseSessionModelToolsOptions = {
  isNew: boolean;
  modelsRefreshKey?: number;
  sessionIdRef: React.MutableRefObject<string | null>;
};

export function useSessionModelTools(opts: UseSessionModelToolsOptions) {
  const {
    isNew,
    modelsRefreshKey,
    sessionIdRef,
  } = opts;

  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelListItem[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<
    Record<string, Record<string, string | null>>
  >({});
  const [newSessionModel, setNewSessionModelState] = useState<{
    provider: string;
    modelId: string;
  } | null>(null);
  const [toolPreset, setToolPreset] = useState<"none" | "default" | "full">("default");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("auto");
  const [currentModelOverride, setCurrentModelOverride] = useState<{
    provider: string;
    modelId: string;
  } | null>(null);
  const [pendingModel, setPendingModel] = useState<{
    provider: string;
    modelId: string;
  } | null>(null);

  const loadTools = useCallback(async (sid: string) => {
    try {
      const tools = await sendAgentCommand<ToolEntry[]>(sid, { type: "get_tools" });
      if (tools && sessionIdRef.current === sid) {
        setToolPreset(getPresetFromTools(tools));
      }
    } catch (e) {
      console.error("Failed to load tools:", e);
    }
  }, [sessionIdRef]);

  const handleModelChange = useCallback(
    async (provider: string, modelId: string) => {
      const sid = sessionIdRef.current;
      if (!sid) {
        setNewSessionModelState({ provider, modelId });
        return;
      }
      try {
        await sendAgentCommand(sid, { type: "set_model", provider, modelId });
        setCurrentModelOverride({ provider, modelId });
      } catch (e) {
        console.error("Failed to set model:", e);
      }
    },
    [sessionIdRef]
  );

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    setThinkingLevel(level);
    if (level === "auto") return;
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
    }
  }, [sessionIdRef]);

  const handleToolPresetChange = useCallback(
    async (preset: "none" | "default" | "full") => {
      const toolNames =
        preset === "none" ? PRESET_NONE : preset === "default" ? PRESET_DEFAULT : PRESET_FULL;
      setToolPreset(preset);
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        await sendAgentCommand(sid, { type: "set_tools", toolNames });
      } catch (e) {
        console.error("Failed to set tools:", e);
      }
    },
    [sessionIdRef]
  );

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then(
        (d: {
          models: Record<string, string>;
          modelList?: ModelListItem[];
          defaultModel?: { provider: string; modelId: string } | null;
          thinkingLevels?: Record<string, string[]>;
          thinkingLevelMaps?: Record<string, Record<string, string | null>>;
        }) => {
          setModelNames(d.models);
          if (d.thinkingLevels) setModelThinkingLevels(d.thinkingLevels);
          if (d.thinkingLevelMaps) setModelThinkingLevelMaps(d.thinkingLevelMaps);
          if (d.modelList) {
            setModelList(d.modelList);
            if (isNew && d.modelList.length > 0) {
              const def = d.defaultModel;
              const match =
                def && d.modelList.find((m) => m.id === def.modelId && m.provider === def.provider);
              const selected = match
                ? { provider: match.provider, modelId: match.id }
                : { provider: d.modelList[0].provider, modelId: d.modelList[0].id };
              setNewSessionModelState(selected);
            }
          }
        }
      )
      .catch((err) => {
        console.error("Failed to load model list:", err);
      });
  }, [isNew, modelsRefreshKey]);

  return {
    modelNames,
    modelList,
    modelThinkingLevels,
    modelThinkingLevelMaps,
    newSessionModel,
    toolPreset,
    setToolPreset,
    thinkingLevel,
    setThinkingLevel,
    currentModelOverride,
    setCurrentModelOverride,
    pendingModel,
    setPendingModel,
    loadTools,
    handleModelChange,
    handleThinkingLevelChange,
    handleToolPresetChange,
  };
}
