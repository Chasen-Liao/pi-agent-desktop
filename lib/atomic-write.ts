/**
 * Atomic file replacement for config files shared across processes
 * (settings.json, desktop-settings.json): write a sibling temp file, then
 * rename it over the target so readers never observe a half-written file.
 */
import { renameSync, unlinkSync, writeFileSync } from "fs";

const RETRY_INTERVAL_MS = 25;
const MAX_RENAME_ATTEMPTS = 100;

export interface WriteFileAtomicOptions {
  retryIntervalMs?: number;
  maxRenameAttempts?: number;
  /** Test hook: defaults to a blocking Atomics.wait sleep. */
  sleepSync?: (ms: number) => void;
}

function defaultSleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Windows blocks rename with EPERM/EACCES while another process holds the
// target open (measured: a tight reader loop required hundreds of retries).
// Readers here are short-lived request-path reads, so a bounded retry clears
// them without giving up atomicity. EAGAIN covers share conflicts surfaced by
// non-local filesystems.
function isRenameSharedConflict(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EAGAIN";
}

export function writeFileAtomic(
  filePath: string,
  data: string,
  options: WriteFileAtomicOptions = {},
): void {
  const retryIntervalMs = options.retryIntervalMs ?? RETRY_INTERVAL_MS;
  const maxRenameAttempts = options.maxRenameAttempts ?? MAX_RENAME_ATTEMPTS;
  const sleepSync = options.sleepSync ?? defaultSleepSync;
  const tmp = `${filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;

  try {
    writeFileSync(tmp, data);
    for (let attempt = 1; ; attempt++) {
      try {
        renameSync(tmp, filePath);
        return;
      } catch (err) {
        if (!isRenameSharedConflict(err) || attempt >= maxRenameAttempts) {
          throw err;
        }
        sleepSync(retryIntervalMs);
      }
    }
  } catch (err) {
    // Last resort: a stuck reader must not block persistence. Direct write
    // matches the pre-atomic behavior (torn reads possible, write delivered).
    console.error(`writeFileAtomic: rename to ${filePath} failed, falling back to direct write`, err);
    writeFileSync(filePath, data);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      // tmp is gone after a successful rename; ignore.
    }
  }
}
