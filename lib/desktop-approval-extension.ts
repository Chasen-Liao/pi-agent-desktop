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
      if (!needsAskConfirm(modeRef.current, event.toolName)) return;
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
