import { existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import type { MenuItemConstructorOptions } from "electron";

export type CloseAction = "tray" | "quit";

/** Type guard checking whether a value is a valid window close action ("tray" or "quit"). */
export function isCloseAction(value: unknown): value is CloseAction {
  return value === "tray" || value === "quit";
}

/**
 * Normalizes a raw agent directory path by stripping surrounding quotes,
 * converting `file://` URLs via `fileURLToPath`, and expanding `~` / `~/...` / `~\...` against `homedir`.
 */
export function normalizeAgentDirPath(rawPath: string, homedir: string = os.homedir()): string {
  let normalized = rawPath.trim();
  if (
    normalized.length >= 2 &&
    ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  if (!normalized) {
    return "";
  }
  if (/^file:\/\//i.test(normalized)) {
    try {
      return fileURLToPath(normalized);
    } catch {
      return normalized;
    }
  }
  if (normalized === "~") {
    return homedir;
  }
  if (normalized.startsWith("~/") || normalized.startsWith("~\\")) {
    return path.join(homedir, normalized.slice(2));
  }
  return normalized;
}

/**
 * Resolves the Pi coding agent configuration directory from an override,
 * `PI_CODING_AGENT_DIR`, or `~/.pi/agent`, aligned with `getAgentDir()`.
 */
export function resolveAgentDir(
  agentDir?: string,
  homedir: string = os.homedir(),
  env: Record<string, string | undefined> = process.env,
): string {
  if (agentDir) {
    const normalizedExplicit = normalizeAgentDirPath(agentDir, homedir);
    if (normalizedExplicit) return normalizedExplicit;
  }
  if (env.PI_CODING_AGENT_DIR) {
    const normalizedEnv = normalizeAgentDirPath(env.PI_CODING_AGENT_DIR, homedir);
    if (normalizedEnv) return normalizedEnv;
  }
  return path.join(homedir, ".pi", "agent");
}

/** Reads the persisted window close action from desktop-settings.json, defaulting to "tray" on missing or invalid data. */
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

/** Determines how the main window close event should be handled given app quit state and user closeAction preference. */
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

/** Returns the localized label for the "Copy Link Address" context menu item based on the active locale. */
export function resolveCopyLinkLabel(locale?: string): string {
  const normalized = (locale ?? "").trim().toLowerCase();
  return normalized.startsWith("zh") ? "复制链接地址" : "Copy Link Address";
}

/** Builds the Electron context menu template for Cut, Copy, Paste, Select All, and optional link copying. */
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
