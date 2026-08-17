import test from "node:test";
import assert from "node:assert/strict";
import { loadPageWithRetry, NavigationLoadError } from "./navigation.ts";

test("app navigation retries a transient load failure and then completes", async () => {
  let attempts = 0;
  const sleeps: number[] = [];

  await loadPageWithRetry(
    "http://127.0.0.1:30141",
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("navigation interrupted");
      }
    },
    {
      delaysMs: [10, 20],
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }
  );

  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [10]);
});

test("app navigation reports a bounded failure after retries are exhausted", async () => {
  let attempts = 0;
  const sleeps: number[] = [];

  let failure: unknown;
  await assert.rejects(
    loadPageWithRetry(
      "http://127.0.0.1:30141",
      async () => {
        attempts += 1;
        throw new Error("server closed");
      },
      {
        delaysMs: [10, 20],
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }
    ),
    (error: unknown) => {
      failure = error;
      return error instanceof NavigationLoadError;
    }
  );

  assert.ok(failure instanceof NavigationLoadError);
  assert.equal(failure.url, "http://127.0.0.1:30141");
  assert.equal(failure.attempts, 3);
  assert.equal((failure.cause as Error).message, "server closed");
  assert.match(failure.message, /server closed/);

  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [10, 20]);
});

test("app navigation uses a short bounded default backoff", async () => {
  const sleeps: number[] = [];

  await assert.rejects(
    loadPageWithRetry(
      "http://127.0.0.1:30141",
      async () => {
        throw new Error("server closed");
      },
      {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }
    ),
    /after 4 attempts/
  );

  assert.deepEqual(sleeps, [100, 250, 500]);
});

test("app navigation stops immediately when the caller cancels retries", async () => {
  const cancelled = new Error("navigation cancelled");
  let attempts = 0;
  const sleeps: number[] = [];

  await assert.rejects(
    loadPageWithRetry(
      "http://127.0.0.1:30141",
      async () => {
        attempts += 1;
        throw cancelled;
      },
      {
        shouldRetry: () => false,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }
    ),
    (error: unknown) => error === cancelled
  );

  assert.equal(attempts, 1);
  assert.deepEqual(sleeps, []);
});

test("app navigation times out a load that never settles", async () => {
  let attempts = 0;
  let cancellations = 0;

  await assert.rejects(
    loadPageWithRetry(
      "http://127.0.0.1:30141",
      async () => {
        attempts += 1;
        await new Promise<void>(() => undefined);
      },
      {
        delaysMs: [],
        attemptTimeoutMs: 10,
        cancelAttempt: () => {
          cancellations += 1;
        },
      }
    ),
    /timed out after 10ms/
  );

  assert.equal(attempts, 1);
  assert.equal(cancellations, 1);
});

test("app navigation aborts a hanging attempt and ignores its late completion", async () => {
  const controller = new AbortController();
  const cancelled = new Error("window lifecycle changed");
  let cancellations = 0;
  let finishLoad: (() => void) | undefined;

  const navigation = loadPageWithRetry(
    "http://127.0.0.1:30141",
    () => new Promise<void>((resolve) => {
      finishLoad = resolve;
    }),
    {
      signal: controller.signal,
      cancelAttempt: () => {
        cancellations += 1;
      },
    }
  );

  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(cancelled);
  await assert.rejects(navigation, (error: unknown) => error === cancelled);
  assert.equal(cancellations, 1);

  finishLoad?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancellations, 1);
});

test("app navigation still settles when cancelling the browser attempt throws", async () => {
  const controller = new AbortController();
  const cancelled = new Error("application is quitting");

  const navigation = loadPageWithRetry(
    "http://127.0.0.1:30141",
    () => new Promise<void>(() => undefined),
    {
      signal: controller.signal,
      cancelAttempt: () => {
        throw new Error("webContents already destroyed");
      },
    }
  );

  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(cancelled);
  await assert.rejects(navigation, (error: unknown) => error === cancelled);
});
