/**
 * Client-safe trust DTO types (no Node/pi imports).
 */

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

export function isTrustOptionId(value: unknown): value is TrustOptionId {
  return (
    value === "trust" ||
    value === "trust-parent" ||
    value === "trust-session" ||
    value === "deny" ||
    value === "deny-session"
  );
}
