import path from "node:path";

declare global {
  var __piWriteLocks: Map<string, Promise<unknown>> | undefined;
}

/**
 * Acquire a process-level write lock on a file path, run `fn`, then release.
 *
 * - Per-file granularity: different paths do not block each other.
 * - Reentrancy NOT supported: calling withFileLock(samePath) inside a fn
 *   holding the lock will deadlock.
 * - Map entry is cleaned up after release if no later caller has chained on.
 * - globalThis is used to survive Next.js hot reloads (matches the
 *   __piSessions / __piStartLocks pattern in lib/rpc-manager.ts).
 */
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(filePath);
  const locks = (globalThis.__piWriteLocks ??= new Map<string, Promise<unknown>>());

  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ourEntry = prev.then(() => gate);
  locks.set(key, ourEntry);

  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (locks.get(key) === ourEntry) {
      locks.delete(key);
    }
  }
}
