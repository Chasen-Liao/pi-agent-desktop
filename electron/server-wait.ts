import http from "node:http";

export function getServerRetryDelayMs(elapsedMs: number): number {
  if (elapsedMs < 5_000) return 100;
  if (elapsedMs < 15_000) return 250;
  return 500;
}

export function waitForHttpServerReady(
  port: number,
  {
    timeoutMs = 60_000,
    requestTimeoutMs = 500,
    getRetryDelayMs = getServerRetryDelayMs,
  }: {
    timeoutMs?: number;
    requestTimeoutMs?: number;
    getRetryDelayMs?: (elapsedMs: number) => number;
  } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    function retry() {
      const elapsed = Date.now() - startTime;
      if (elapsed > timeoutMs) {
        reject(new Error(`Server not ready after ${timeoutMs / 1000}s`));
        return;
      }
      setTimeout(tryRequest, getRetryDelayMs(elapsed));
    }

    function tryRequest() {
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path: "/api/health",
          timeout: requestTimeoutMs,
        },
        (res) => {
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
            resolve();
          } else {
            retry();
          }
        }
      );
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    }

    tryRequest();
  });
}
