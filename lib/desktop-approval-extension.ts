/**
 * Inline pi extension: Ask-mode confirms for bash/write/edit.
 */
import type { ExtensionAPI, ExtensionFactory, InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  askBlockResult,
  needsAskConfirm,
  summarizeToolCall,
  type AgentMode,
} from "./approval-policy.ts";

export type AgentModeRef = { current: AgentMode };

export function createDesktopApprovalFactory(modeRef: AgentModeRef): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on("tool_call", async (event, ctx) => {
      const all = typeof pi.getAllTools === "function" ? pi.getAllTools() : [];
      const toolDef = all.find((t) => t.name === event.toolName);
      const isBuiltin = toolDef?.sourceInfo?.source === "builtin";
      const isBuiltinLtmRecall =
        event.toolName === "memory_recall" &&
        (toolDef?.sourceInfo?.source === "builtin" ||
          toolDef?.sourceInfo?.path === "<inline:desktop-ltm>");
      const isCustom = !toolDef || (!isBuiltin && !isBuiltinLtmRecall);
      if (!needsAskConfirm(modeRef.current, event.toolName, isCustom)) return;
      const ok = await ctx.ui.confirm(
        `允许 ${event.toolName}?`,
        summarizeToolCall(event.toolName, event.input)
      );
      if (!ok) return askBlockResult();
    });
  };
}

export function desktopApprovalInlineExtension(modeRef: AgentModeRef): InlineExtension {
  return {
    name: "desktop-approval",
    factory: createDesktopApprovalFactory(modeRef),
  };
}
