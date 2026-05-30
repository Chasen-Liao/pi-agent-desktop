import http from "node:http";

type ReadyOutputStream = {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  off(event: "data", listener: (chunk: Buffer | string) => void): unknown;
};

type ReadyProcess = {
  stdout?: ReadyOutputStream | null;
  stderr?: ReadyOutputStream | null;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  off(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
};

export function getServerRetryDelayMs(elapsedMs: number): number {
  if (elapsedMs < 5_000) return 100;
  if (elapsedMs < 15_000) return 250;
  return 500;
}

export function waitForHttpServerReady(
  port: number,
  {
    timeoutMs = 60_000,
    requestTimeoutMs = 15_000,
    getRetryDelayMs = getServerRetryDelayMs,
    signal,
  }: {
    timeoutMs?: number;
    requestTimeoutMs?: number;
    getRetryDelayMs?: (elapsedMs: number) => number;
    signal?: AbortSignal;
  } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let settled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let currentRequest: http.ClientRequest | null = null;

    function cleanup() {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (currentRequest) {
        currentRequest.destroy();
        currentRequest = null;
      }
      signal?.removeEventListener("abort", onAbort);
    }

    function finish<T>(fn: (value: T) => void, value: T) {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    }

    function onAbort() {
      finish(reject, new Error("Server readiness wait aborted"));
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    function retry() {
      if (settled) return;
      const elapsed = Date.now() - startTime;
      if (elapsed > timeoutMs) {
        finish(reject, new Error(`Server not ready after ${timeoutMs / 1000}s`));
        return;
      }
      retryTimer = setTimeout(tryRequest, getRetryDelayMs(elapsed));
    }

    function tryRequest() {
      if (settled) return;
      retryTimer = null;
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path: "/api/health",
          timeout: requestTimeoutMs,
        },
        (res) => {
          currentRequest = null;
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
            finish(resolve, undefined);
          } else {
            retry();
          }
        }
      );
      currentRequest = req;
      req.on("error", () => {
        if (currentRequest === req) currentRequest = null;
        retry();
      });
      req.on("timeout", () => {
        if (currentRequest === req) currentRequest = null;
        req.destroy();
        retry();
      });
    }

    tryRequest();
  });
}

function waitForNextReadyOutput(
  proc: Pick<ReadyProcess, "stdout" | "stderr">,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish(reject, new Error(`Next ready output not seen after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      proc.stdout?.off("data", onData);
      proc.stderr?.off("data", onData);
      signal?.removeEventListener("abort", onAbort);
    }

    function finish<T>(fn: (value: T) => void, value: T) {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    }

    function onData(chunk: Buffer | string) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      if (text.includes("Ready")) {
        finish(resolve, undefined);
      }
    }

    function onAbort() {
      finish(reject, new Error("Next ready output wait aborted"));
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
  });
}

export function waitForNextServerReady(
  port: number,
  proc: ReadyProcess,
  options: {
    timeoutMs?: number;
    requestTimeoutMs?: number;
    getRetryDelayMs?: (elapsedMs: number) => number;
  } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const readyAbort = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;

    function cleanup() {
      proc.off("exit", onExit);
      proc.off("error", onError);
    }

    function finish<T>(fn: (value: T) => void, value: T) {
      if (settled) return;
      settled = true;
      readyAbort.abort();
      cleanup();
      fn(value);
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      finish(reject, new Error(`Next server exited before ready: code=${code ?? "null"} signal=${signal ?? "null"}`));
    }

    function onError(error: Error) {
      finish(reject, error);
    }

    proc.once("exit", onExit);
    proc.once("error", onError);

    Promise.any([
      waitForNextReadyOutput(proc, timeoutMs, readyAbort.signal),
      waitForHttpServerReady(port, { ...options, signal: readyAbort.signal }),
    ]).then(
      () => finish(resolve, undefined),
      (error: AggregateError) => finish(reject, error.errors[0] instanceof Error ? error.errors[0] : error)
    );
  });
}
