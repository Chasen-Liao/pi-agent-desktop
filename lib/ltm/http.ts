import type { MemoryType } from "./types.ts";

export const LTM_DISABLED = "ltm_disabled";
export const LTM_STATS_NOT_SUPPORTED = "ltm_stats_not_supported";

const MEMORY_TYPES = new Set<MemoryType>([
  "pattern",
  "preference",
  "architecture",
  "bug",
  "workflow",
  "fact",
]);

const DEFAULT_LIMIT = 10;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

export type ParseOk<T> = { ok: true; value: T };
export type ParseErr = { ok: false; error: string };
export type ParseResult<T> = ParseOk<T> | ParseErr;

export interface RecallQuery {
  cwd: string;
  query: string;
  limit?: number;
}

export interface StatsQuery {
  cwd: string;
}

export interface RememberBody {
  cwd: string;
  content: string;
  type?: MemoryType;
  concepts?: string[];
  files?: string[];
}

export interface ForgetBody {
  cwd: string;
  memoryIds?: string[];
  observationIds?: string[];
}

export function isLtmDisabledError(err: unknown): boolean {
  return isLtmError(err, LTM_DISABLED);
}

export function isStatsNotSupportedError(err: unknown): boolean {
  return isLtmError(err, LTM_STATS_NOT_SUPPORTED);
}

function isLtmError(err: unknown, code: string): boolean {
  return err instanceof Error && err.message === code;
}

export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === "string" && MEMORY_TYPES.has(value as MemoryType);
}

/** Clamp limit to [1, 50]; invalid → default 10. */
export function parseLimit(value: unknown): number {
  if (value === null || value === undefined || value === "") return DEFAULT_LIMIT;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(num)));
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stringArray(value: unknown, field: string): ParseResult<string[] | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (!Array.isArray(value)) {
    return { ok: false, error: `${field} must be an array of strings` };
  }
  for (const item of value) {
    if (typeof item !== "string") {
      return { ok: false, error: `${field} must be an array of strings` };
    }
  }
  return { ok: true, value: value as string[] };
}

/**
 * GET /api/memory/recall — require `cwd` + `q`; optional `limit`.
 * Accepts URL, URLSearchParams, or a full request URL string.
 */
export function parseRecallQuery(
  input: URL | URLSearchParams | string
): ParseResult<RecallQuery> {
  const params =
    input instanceof URLSearchParams
      ? input
      : input instanceof URL
        ? input.searchParams
        : new URL(input, "http://localhost").searchParams;

  const cwd = nonEmptyString(params.get("cwd"));
  if (!cwd) return { ok: false, error: "cwd is required" };

  const q = nonEmptyString(params.get("q"));
  if (!q) return { ok: false, error: "q is required" };

  const limitRaw = params.get("limit");
  const limit =
    limitRaw === null || limitRaw === ""
      ? undefined
      : parseLimit(limitRaw);

  return {
    ok: true,
    value: limit === undefined ? { cwd, query: q } : { cwd, query: q, limit },
  };
}

/** GET /api/memory/stats — require `cwd`. */
export function parseStatsQuery(
  input: URL | URLSearchParams | string
): ParseResult<StatsQuery> {
  const params =
    input instanceof URLSearchParams
      ? input
      : input instanceof URL
        ? input.searchParams
        : new URL(input, "http://localhost").searchParams;

  const cwd = nonEmptyString(params.get("cwd"));
  if (!cwd) return { ok: false, error: "cwd is required" };
  return { ok: true, value: { cwd } };
}

/** POST /api/memory/remember — JSON body. */
export function parseRememberBody(body: unknown): ParseResult<RememberBody> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "JSON body is required" };
  }
  const o = body as Record<string, unknown>;

  const cwd = nonEmptyString(o.cwd);
  if (!cwd) return { ok: false, error: "cwd is required" };

  if (typeof o.content !== "string" || o.content.trim().length === 0) {
    return { ok: false, error: "content is required" };
  }

  let type: MemoryType | undefined;
  if (o.type !== undefined && o.type !== null) {
    if (!isMemoryType(o.type)) {
      return {
        ok: false,
        error:
          "type must be one of: pattern, preference, architecture, bug, workflow, fact",
      };
    }
    type = o.type;
  }

  const concepts = stringArray(o.concepts, "concepts");
  if (!concepts.ok) return concepts;

  const files = stringArray(o.files, "files");
  if (!files.ok) return files;

  const result: RememberBody = { cwd, content: o.content };
  if (type !== undefined) result.type = type;
  if (concepts.value !== undefined) result.concepts = concepts.value;
  if (files.value !== undefined) result.files = files.value;
  return { ok: true, value: result };
}

/** POST /api/memory/forget — JSON body. */
export function parseForgetBody(body: unknown): ParseResult<ForgetBody> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "JSON body is required" };
  }
  const o = body as Record<string, unknown>;

  const cwd = nonEmptyString(o.cwd);
  if (!cwd) return { ok: false, error: "cwd is required" };

  const memoryIds = stringArray(o.memoryIds, "memoryIds");
  if (!memoryIds.ok) return memoryIds;

  const observationIds = stringArray(o.observationIds, "observationIds");
  if (!observationIds.ok) return observationIds;

  const hasMem =
    memoryIds.value !== undefined && memoryIds.value.length > 0;
  const hasObs =
    observationIds.value !== undefined && observationIds.value.length > 0;
  if (!hasMem && !hasObs) {
    return {
      ok: false,
      error: "memoryIds or observationIds is required",
    };
  }

  const result: ForgetBody = { cwd };
  if (memoryIds.value !== undefined) result.memoryIds = memoryIds.value;
  if (observationIds.value !== undefined) {
    result.observationIds = observationIds.value;
  }
  return { ok: true, value: result };
}
