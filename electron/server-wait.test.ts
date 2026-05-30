import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { getServerRetryDelayMs, waitForHttpServerReady, waitForNextServerReady } from "./server-wait.ts";

function createFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  return proc;
}

test("server readiness polling retries quickly during early startup", () => {
  assert.equal(getServerRetryDelayMs(0), 100);
  assert.equal(getServerRetryDelayMs(4_999), 100);
});

test("server readiness polling backs off after early startup window", () => {
  assert.equal(getServerRetryDelayMs(5_000), 250);
  assert.equal(getServerRetryDelayMs(15_000), 500);
});

test("server readiness polls a lightweight health path", async () => {
  const requests: string[] = [];
  const server = net.createServer((socket) => {
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (!data.includes("\r\n\r\n")) return;
      requests.push(data.split(" ")[1] ?? "");
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await waitForHttpServerReady(address.port, { timeoutMs: 150, requestTimeoutMs: 20, getRetryDelayMs: () => 10 });
    assert.deepEqual(requests, ["/api/health"]);
  } finally {
    server.close();
    if (server.listening) await once(server, "close");
  }
});

test("server readiness retries non-successful health responses", async () => {
  const server = net.createServer((socket) => {
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (!data.includes("\r\n\r\n")) return;
      socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await assert.rejects(
      waitForHttpServerReady(address.port, { timeoutMs: 150, requestTimeoutMs: 20, getRetryDelayMs: () => 10 }),
      /Server not ready after 0.15s/
    );
  } finally {
    server.close();
    if (server.listening) await once(server, "close");
  }
});

test("server readiness allows a slow first health response during cold startup", async () => {
  const server = net.createServer((socket) => {
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (!data.includes("\r\n\r\n")) return;
      setTimeout(() => {
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
      }, 650);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await waitForHttpServerReady(address.port, { timeoutMs: 900, getRetryDelayMs: () => 10 });
  } finally {
    server.close();
    if (server.listening) await once(server, "close");
  }
});

test("next server readiness resolves from Next ready output before slow health route", async () => {
  const proc = createFakeProcess();
  const server = net.createServer((socket) => {
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (!data.includes("\r\n\r\n")) return;
      setTimeout(() => {
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
      }, 650);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const ready = waitForNextServerReady(address.port, proc, { timeoutMs: 900, getRetryDelayMs: () => 10 });
    setTimeout(() => proc.stdout.write("✓ Ready in 0ms\n"), 50);
    await ready;
  } finally {
    server.close();
    if (server.listening) await once(server, "close");
  }
});

test("next server readiness rejects promptly when child exits before ready", async () => {
  const proc = createFakeProcess();
  const started = Date.now();
  const ready = waitForNextServerReady(9, proc, { timeoutMs: 900, getRetryDelayMs: () => 100 });
  setTimeout(() => proc.emit("exit", 1, null), 20);

  await assert.rejects(ready, /Next server exited before ready/);
  assert.ok(Date.now() - started < 200);
});

test("next server readiness stops health polling after Next ready output wins", async () => {
  const proc = createFakeProcess();
  let requests = 0;
  const server = net.createServer((socket) => {
    requests += 1;
    socket.on("data", () => {
      // Keep the request open so a missing cancellation would retry after timeout.
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const ready = waitForNextServerReady(address.port, proc, {
      timeoutMs: 500,
      requestTimeoutMs: 40,
      getRetryDelayMs: () => 10,
    });
    setTimeout(() => proc.stdout.write("✓ Ready in 0ms\n"), 20);
    await ready;
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(requests, 1);
  } finally {
    server.close();
    if (server.listening) await once(server, "close");
  }
});

test("next server readiness removes output listeners after health route wins", async () => {
  const proc = createFakeProcess();
  const server = net.createServer((socket) => {
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (!data.includes("\r\n\r\n")) return;
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await waitForNextServerReady(address.port, proc, { timeoutMs: 500, getRetryDelayMs: () => 10 });
    assert.equal(proc.stdout.listenerCount("data"), 0);
    assert.equal(proc.stderr.listenerCount("data"), 0);
  } finally {
    server.close();
    if (server.listening) await once(server, "close");
  }
});
