import { existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import type { MenuItemConstructorOptions } from "electron";

export type CloseAction = "tray" | "quit";

export function isCloseAction(value: unknown): value is CloseAction {
  return value === "tray" || value === "quit";
}

export function resolveAgentDir(agentDir?: string): string {
  if (agentDir && agentDir.trim()) return agentDir;
  if (process.env.PI_CODING_AGENT_DIR && process.env.PI_CODING_AGENT_DIR.trim()) {
    return process.env.PI_CODING_AGENT_DIR;
  }
  return path.join(os.homedir(), ".pi", "agent");
}

export function readCloseActionFromDisk(agentDir?: string): CloseAction {
  const settingsPath = path.join(resolveAgentDir(agentDir), "desktop-settings.json");
  if (!existsSync(settingsPath)) return "tray";
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const action = (parsed as Record<string, unknown>).closeAction;
      if (isCloseAction(action)) return action;
    }
    return "tray";
  } catch {
    return "tray";
  }
}

export type WindowCloseDecision = "allow-close" | "hide-to-tray" | "quit-app";

export function decideWindowCloseAction(input: {
  isQuitting: boolean;
  closeAction: CloseAction;
}): WindowCloseDecision {
  if (input.isQuitting) {
    return "allow-close";
  }
  return input.closeAction === "quit" ? "quit-app" : "hide-to-tray";
}

export interface ContextMenuEditFlags {
  canCut?: boolean;
  canCopy?: boolean;
  canPaste?: boolean;
  canSelectAll?: boolean;
}

export interface ContextMenuInput {
  linkURL?: string;
  isEditable?: boolean;
  selectionText?: string;
  editFlags?: ContextMenuEditFlags;
}

export function resolveCopyLinkLabel(locale?: string): string {
  const normalized = (locale ?? "").trim().toLowerCase();
  return normalized.startsWith("zh") ? "复制链接地址" : "Copy Link Address";
}

export function buildContextMenuTemplate(
  params: ContextMenuInput,
  options: {
    locale?: string;
    onCopyLink: (url: string) => void;
  },
): MenuItemConstructorOptions[] {
  const hasSelection = Boolean(params.selectionText && params.selectionText.length > 0);
  const canCut = params.editFlags?.canCut ?? Boolean(params.isEditable && hasSelection);
  const canCopy = params.editFlags?.canCopy ?? hasSelection;
  const canPaste = params.editFlags?.canPaste ?? Boolean(params.isEditable);
  const canSelectAll = params.editFlags?.canSelectAll ?? true;

  const items: MenuItemConstructorOptions[] = [
    { role: "cut", enabled: canCut },
    { role: "copy", enabled: canCopy },
    { role: "paste", enabled: canPaste },
    { role: "selectAll", enabled: canSelectAll },
  ];

  const linkURL = (params.linkURL ?? "").trim();
  if (linkURL) {
    items.push(
      { type: "separator" },
      {
        id: "copy-link-address",
        label: resolveCopyLinkLabel(options.locale),
        click: () => options.onCopyLink(linkURL),
      },
    );
  }

  return items;
}
