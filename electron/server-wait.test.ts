import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import { getServerRetryDelayMs, waitForHttpServerReady } from "./server-wait.ts";

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
