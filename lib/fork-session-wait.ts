/**
 * Resolve a newly forked session without a single fixed short sleep.
 * Retries list fetch with backoff, then falls back to a direct single-session lookup.
 */

export type ForkWaitSession = { id: string };

export type ResolveForkedSessionOptions = {
  /** Delays between list attempts (ms). Default: 50, 100, 200, 400, 800 */
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_DELAYS_MS = [50, 100, 200, 400, 800];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find `sessionId` via list retries, then optional direct fetch.
 * Returns null if still missing after all attempts.
 */
export async function resolveForkedSession<T extends ForkWaitSession>(
  sessionId: string,
  fetchList: () => Promise<T[]>,
  fetchOne?: (id: string) => Promise<T | null>,
  options: ResolveForkedSessionOptions = {}
): Promise<T | null> {
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;

  for (let i = 0; i <= delays.length; i++) {
    const list = await fetchList();
    const found = list.find((s) => s.id === sessionId);
    if (found) return found;
    if (i < delays.length) {
      await sleep(delays[i]);
    }
  }

  if (fetchOne) {
    try {
      return (await fetchOne(sessionId)) ?? null;
    } catch {
      return null;
    }
  }
  return null;
}
