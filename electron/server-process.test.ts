import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { wrapUtilityServerProcess } from "./server-process.ts";

class FakeUtilityProcess extends EventEmitter {
  pid: number | undefined;
  stdout = new PassThrough();
  stderr = new PassThrough();
  killCalls = 0;

  kill(): boolean {
    this.killCalls += 1;
    this.pid = undefined;
    return true;
  }
}

test("normalizes utility-process exit events for server lifecycle handling", () => {
  const utility = new FakeUtilityProcess();
  const server = wrapUtilityServerProcess(
    utility as unknown as Electron.UtilityProcess,
    () => null,
  );
  let exit: [number | null, NodeJS.Signals | null] | null = null;
  server.once("exit", (code, signal) => {
    exit = [code, signal];
  });

  utility.emit("exit", 23);

  assert.deepEqual(exit, [23, null]);
  assert.equal(server.exitCode, 23);
  assert.equal(server.killed, true);
});

test("converts utility-process fatal errors into Error objects", () => {
  const utility = new FakeUtilityProcess();
  const server = wrapUtilityServerProcess(
    utility as unknown as Electron.UtilityProcess,
    () => null,
  );
  const received: Error[] = [];
  server.once("error", (error) => {
    received.push(error);
  });

  utility.emit("error", "FatalError", "server.js:1", "diagnostic report");

  assert.equal(received.length, 1);
  assert.match(received[0]!.message, /FatalError at server\.js:1/);
  assert.equal(received[0]!.cause, "diagnostic report");
});

test("terminates a utility process without requiring a ChildProcess handle", () => {
  const utility = new FakeUtilityProcess();
  const server = wrapUtilityServerProcess(
    utility as unknown as Electron.UtilityProcess,
    (process) => {
      process.kill();
      return null;
    },
  );

  assert.equal(server.terminate(), null);
  assert.equal(utility.killCalls, 1);
  assert.equal(server.killed, true);
});
