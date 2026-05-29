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

test("server readiness waits for an HTTP response instead of an open TCP port", async () => {
  const server = net.createServer((socket) => {
    socket.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");

  await assert.rejects(
    waitForHttpServerReady(address.port, { timeoutMs: 150, getRetryDelayMs: () => 10 }),
    /Server not ready after 0.15s/
  );

  server.close();
  await once(server, "close");
});
