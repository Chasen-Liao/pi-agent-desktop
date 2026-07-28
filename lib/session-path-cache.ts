/**
 * Positive path cache + short-TTL negative cache for session id → file path.
 * Extracted for unit testing without touching SessionManager.listAll.
 */

export const SESSION_MISS_TTL_MS = 30_000;

export type SessionPathCacheState = {
  paths: Map<string, string>;
  misses: Map<string, number>;
};

export function createSessionPathCacheState(): SessionPathCacheState {
  return { paths: new Map(), misses: new Map() };
}

export function getCachedSessionPath(
  state: SessionPathCacheState,
  sessionId: string,
  now = Date.now()
): { hit: true; path: string } | { hit: false; negative: boolean } {
  const path = state.paths.get(sessionId);
  if (path) return { hit: true, path };

  const missUntil = state.misses.get(sessionId);
  if (missUntil !== undefined && now < missUntil) {
    return { hit: false, negative: true };
  }
  return { hit: false, negative: false };
}

export function markSessionPathMiss(
  state: SessionPathCacheState,
  sessionId: string,
  now = Date.now(),
  ttlMs = SESSION_MISS_TTL_MS
): void {
  state.misses.set(sessionId, now + ttlMs);
}

export function cacheSessionPathEntry(
  state: SessionPathCacheState,
  sessionId: string,
  filePath: string
): void {
  state.paths.set(sessionId, filePath);
  state.misses.delete(sessionId);
}

export function invalidateSessionPathEntry(
  state: SessionPathCacheState,
  sessionId: string
): void {
  state.paths.delete(sessionId);
  state.misses.delete(sessionId);
}
