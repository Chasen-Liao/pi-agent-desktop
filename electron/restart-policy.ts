export type ServerState = "starting" | "ready" | "stopped";

const RESTART_LIMIT = 3;
const RESTART_WINDOW_MS = 60_000;

export function getNextRestartState(input: {
  now: number;
  attempts: number[];
  serverState: ServerState;
  isQuitting: boolean;
}): { shouldRestart: boolean; attempts: number[] } {
  if (input.isQuitting || input.serverState !== "ready") {
    return { shouldRestart: false, attempts: input.attempts };
  }

  const attempts = input.attempts.filter((startedAt) => input.now - startedAt < RESTART_WINDOW_MS);
  if (attempts.length >= RESTART_LIMIT) {
    return { shouldRestart: false, attempts };
  }

  return { shouldRestart: true, attempts: [...attempts, input.now] };
}
