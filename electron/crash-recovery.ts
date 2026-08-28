// Recovery policy for renderer process crashes ("render-process-gone").
// Mirrors restart-policy.ts: bounded auto-reload inside a time window so a
// persistent crash (e.g. GPU/driver failure, OOM loop) cannot turn into an
// infinite reload loop.

const RELOAD_LIMIT = 3;
const RELOAD_WINDOW_MS = 60_000;

export function getNextCrashReloadState(input: {
  now: number;
  reason: string;
  attempts: number[];
  isQuitting: boolean;
}): { shouldReload: boolean; attempts: number[] } {
  // "clean-exit" means the renderer exited on purpose (e.g. window teardown);
  // reloading would fight the normal shutdown path.
  if (input.isQuitting || input.reason === "clean-exit") {
    return { shouldReload: false, attempts: input.attempts };
  }

  const attempts = input.attempts.filter((startedAt) => input.now - startedAt < RELOAD_WINDOW_MS);
  if (attempts.length >= RELOAD_LIMIT) {
    return { shouldReload: false, attempts };
  }

  return { shouldReload: true, attempts: [...attempts, input.now] };
}
