export type LoadPage = (url: string) => Promise<void>;

export type LoadPageWithRetryOptions = {
  /** Delays between attempts. The default is 100, 250, then 500ms. */
  delaysMs?: readonly number[];
  /** Maximum time allowed for each load attempt. Defaults to 15 seconds. */
  attemptTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Return false when the caller's lifecycle no longer allows another attempt. */
  shouldRetry?: (error: unknown) => boolean;
  /** Abort the current attempt when the caller's lifecycle ends. */
  signal?: AbortSignal;
  /** Stop the underlying browser navigation after a timeout or abort. */
  cancelAttempt?: () => void;
};

const DEFAULT_DELAYS_MS = [100, 250, 500];
const DEFAULT_ATTEMPT_TIMEOUT_MS = 15_000;

export class NavigationLoadError extends Error {
  readonly url: string;
  readonly attempts: number;

  constructor(
    url: string,
    attempts: number,
    cause: unknown
  ) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `Failed to load ${url} after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${causeMessage}`
    );
    this.name = "NavigationLoadError";
    this.url = url;
    this.attempts = attempts;
    this.cause = cause;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadPageWithTimeout(
  url: string,
  loadPage: LoadPage,
  timeoutMs: number,
  signal?: AbortSignal,
  cancelAttempt?: () => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cancelUnderlyingAttempt = () => {
      try {
        cancelAttempt?.();
      } catch {
        // Cancellation is best-effort; the timeout/abort must still settle.
      }
    };
    const timeout = setTimeout(() => {
      cancelUnderlyingAttempt();
      finish(reject, new Error(`Navigation to ${url} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onAbort = () => {
      cancelUnderlyingAttempt();
      const reason = signal?.reason;
      finish(reject, reason instanceof Error ? reason : new Error("Navigation aborted"));
    };

    function cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }

    function finish<T>(fn: (value: T) => void, value: T) {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    Promise.resolve()
      .then(() => loadPage(url))
      .then(
        () => {
          finish(resolve, undefined);
        },
        (error: unknown) => {
          finish(reject, error);
        }
      );
  });
}

/**
 * Load a page through the Electron navigation boundary, retrying transient
 * failures a small, fixed number of times before throwing a diagnostic error
 * that preserves the final failure as its cause.
 */
export async function loadPageWithRetry(
  url: string,
  loadPage: LoadPage,
  options: LoadPageWithRetryOptions = {}
): Promise<void> {
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? (() => true);

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      await loadPageWithTimeout(url, loadPage, attemptTimeoutMs, options.signal, options.cancelAttempt);
      return;
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }
      if (!shouldRetry(error)) {
        throw error;
      }
      if (attempt === delays.length) {
        throw new NavigationLoadError(url, attempt + 1, error);
      }
      await sleep(delays[attempt]);
    }
  }

  throw new Error(`Navigation failed for ${url}`);
}
