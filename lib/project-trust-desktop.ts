/**
 * Project trust helpers for desktop session start (HTTP 409 handshake).
 * Uses pi's ProjectTrustStore + hasTrustRequiringProjectResources when available.
 */
import { dirname } from "path";
import {
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

export type TrustOptionId = "trust" | "trust-parent" | "trust-session" | "deny" | "deny-session";

export interface TrustOptionDto {
  id: TrustOptionId;
  label: string;
  trusted: boolean;
  /** Empty updates = session-only (not persisted). */
  persist: boolean;
  path?: string;
  parentPath?: string;
}

export interface NeedsTrustPayload {
  needsTrust: true;
  cwd: string;
  options: TrustOptionDto[];
}

export function getTrustParentPath(cwd: string): string | undefined {
  const parent = dirname(cwd);
  return parent === cwd ? undefined : parent;
}

/** Options mirrored from pi's getProjectTrustOptions (includeSessionOnly: true). */
export function buildTrustOptions(cwd: string): TrustOptionDto[] {
  const parentPath = getTrustParentPath(cwd);
  const options: TrustOptionDto[] = [
    { id: "trust", label: "Trust", trusted: true, persist: true, path: cwd },
  ];
  if (parentPath) {
    options.push({
      id: "trust-parent",
      label: `Trust parent folder (${parentPath})`,
      trusted: true,
      persist: true,
      path: cwd,
      parentPath,
    });
  }
  options.push({
    id: "trust-session",
    label: "Trust (this session only)",
    trusted: true,
    persist: false,
  });
  options.push({
    id: "deny",
    label: "Do not trust",
    trusted: false,
    persist: true,
    path: cwd,
  });
  options.push({
    id: "deny-session",
    label: "Do not trust (this session only)",
    trusted: false,
    persist: false,
  });
  return options;
}

export type TrustGateResult =
  | { action: "proceed"; trusted: boolean }
  | { action: "prompt"; payload: NeedsTrustPayload };

/**
 * Decide whether session start can proceed or client must show trust UI.
 * @param sessionOnlyTrust — optional in-memory decision for this process (session-only options)
 */
export function evaluateProjectTrust(
  cwd: string,
  options?: {
    agentDir?: string;
    sessionOnlyTrust?: Map<string, boolean>;
    /** When true, skip prompt and force trusted (e.g. after session-only trust). */
    forceTrusted?: boolean;
  }
): TrustGateResult {
  if (options?.forceTrusted) {
    return { action: "proceed", trusted: true };
  }

  if (!hasTrustRequiringProjectResources(cwd)) {
    return { action: "proceed", trusted: true };
  }

  const sessionMap = options?.sessionOnlyTrust;
  if (sessionMap?.has(cwd)) {
    return { action: "proceed", trusted: sessionMap.get(cwd)! };
  }

  const agentDir = options?.agentDir ?? getAgentDir();
  const store = new ProjectTrustStore(agentDir);
  const decision = store.get(cwd);
  if (decision === true || decision === false) {
    return { action: "proceed", trusted: decision };
  }

  // No saved decision — desktop always has UI → prompt (defaultProjectTrust "ask")
  return {
    action: "prompt",
    payload: {
      needsTrust: true,
      cwd,
      options: buildTrustOptions(cwd),
    },
  };
}

export function applyTrustDecision(
  cwd: string,
  optionId: TrustOptionId,
  options?: {
    agentDir?: string;
    sessionOnlyTrust?: Map<string, boolean>;
  }
): { trusted: boolean; persisted: boolean } {
  const agentDir = options?.agentDir ?? getAgentDir();
  const store = new ProjectTrustStore(agentDir);
  const parentPath = getTrustParentPath(cwd);

  switch (optionId) {
    case "trust":
      store.set(cwd, true);
      return { trusted: true, persisted: true };
    case "trust-parent":
      if (parentPath) {
        store.setMany([
          { path: parentPath, decision: true },
          { path: cwd, decision: null },
        ]);
      } else {
        store.set(cwd, true);
      }
      return { trusted: true, persisted: true };
    case "trust-session":
      options?.sessionOnlyTrust?.set(cwd, true);
      return { trusted: true, persisted: false };
    case "deny":
      store.set(cwd, false);
      return { trusted: false, persisted: true };
    case "deny-session":
      options?.sessionOnlyTrust?.set(cwd, false);
      return { trusted: false, persisted: false };
    default:
      throw new Error(`Unknown trust option: ${optionId}`);
  }
}

export function isTrustOptionId(value: unknown): value is TrustOptionId {
  return (
    value === "trust" ||
    value === "trust-parent" ||
    value === "trust-session" ||
    value === "deny" ||
    value === "deny-session"
  );
}
