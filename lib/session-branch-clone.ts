import type { SessionEntry, SessionHeader } from "./types.ts";

export interface BranchPayload {
  targetEntryId: string;
  name?: string;
}

export interface ClonePayload {
  targetCwd?: string;
  name?: string;
}

export type ValidationResult<T> =
  | { valid: true; data: T }
  | { valid: false; error: string };

export function validateBranchPayload(payload: unknown): ValidationResult<BranchPayload> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { valid: false, error: "Payload must be an object" };
  }

  const record = payload as Record<string, unknown>;

  if (typeof record.targetEntryId !== "string" || record.targetEntryId.trim().length === 0) {
    return { valid: false, error: "targetEntryId is required and must be a non-empty string" };
  }

  if (record.name !== undefined && typeof record.name !== "string") {
    return { valid: false, error: "name must be a string if provided" };
  }

  return {
    valid: true,
    data: {
      targetEntryId: record.targetEntryId.trim(),
      ...(typeof record.name === "string" && record.name.trim().length > 0
        ? { name: record.name.trim() }
        : {}),
    },
  };
}

export function validateClonePayload(payload: unknown): ValidationResult<ClonePayload> {
  if (payload === undefined || payload === null) {
    return { valid: true, data: {} };
  }

  if (typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, error: "Payload must be an object" };
  }

  const record = payload as Record<string, unknown>;

  if (record.targetCwd !== undefined && typeof record.targetCwd !== "string") {
    return { valid: false, error: "targetCwd must be a string if provided" };
  }

  if (record.name !== undefined && typeof record.name !== "string") {
    return { valid: false, error: "name must be a string if provided" };
  }

  return {
    valid: true,
    data: {
      ...(typeof record.targetCwd === "string" && record.targetCwd.trim().length > 0
        ? { targetCwd: record.targetCwd.trim() }
        : {}),
      ...(typeof record.name === "string" && record.name.trim().length > 0
        ? { name: record.name.trim() }
        : {}),
    },
  };
}

export function extractAncestryPath(
  entries: SessionEntry[],
  targetEntryId: string
): SessionEntry[] {
  if (!Array.isArray(entries) || !targetEntryId) {
    return [];
  }

  const map = new Map<string, SessionEntry>();
  for (const entry of entries) {
    if (entry && entry.id) {
      map.set(entry.id, entry);
    }
  }

  const target = map.get(targetEntryId);
  if (!target) {
    return [];
  }

  const path: SessionEntry[] = [];
  let curr: SessionEntry | undefined = target;
  const visited = new Set<string>();

  while (curr) {
    if (visited.has(curr.id)) {
      break; // prevent infinite loops on cyclic parent pointers
    }
    visited.add(curr.id);
    path.push(curr);
    if (!curr.parentId) break;
    curr = map.get(curr.parentId);
  }

  return path.reverse();
}

export function createBranchedHeader(options: {
  sourceSessionId: string;
  cwd: string;
  name?: string;
  newSessionId?: string;
}): SessionHeader {
  if (!options.sourceSessionId) {
    throw new Error("sourceSessionId is required to create a branched header");
  }
  if (!options.cwd) {
    throw new Error("cwd is required to create a branched header");
  }

  return {
    type: "session",
    id: options.newSessionId ?? crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    cwd: options.cwd,
    parentSession: options.sourceSessionId,
    ...(options.name ? { name: options.name } : {}),
  };
}

export function createClonedHeader(options: {
  sourceHeader: SessionHeader;
  targetCwd?: string;
  name?: string;
  newSessionId?: string;
}): SessionHeader {
  if (!options.sourceHeader || !options.sourceHeader.id) {
    throw new Error("valid sourceHeader is required to create a cloned header");
  }

  const header: SessionHeader = {
    ...options.sourceHeader,
    id: options.newSessionId ?? crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    cwd: options.targetCwd ?? options.sourceHeader.cwd,
  };

  if (options.name) {
    header.name = options.name;
  }

  return header;
}
