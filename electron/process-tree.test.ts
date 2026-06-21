import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { killProcessTree } from "./process-tree.ts";

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    // On Unix-like systems, check if the process is a zombie (defunct)
    if (process.platform !== "win32") {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const stateMatch = stat.match(/\) ([A-Z])/);
        if (stateMatch && stateMatch[1] === "Z") {
          return false; // Zombie/defunct is not running
        }
      } catch {
        // Fall back to ps check if /proc is not mounted/accessible
        try {
          const psResult = spawnSync("ps", ["-p", String(pid), "-o", "state="], { encoding: "utf8" });
          if (psResult.status === 0 && psResult.stdout.trim() === "Z") {
            return false;
          }
        } catch {
          // ignore
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

test("killProcessTree terminates a child process and its descendants", async () => {
  const parent = spawn(
    process.execPath,
    [
      "-e",
      `const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
console.log(child.pid);
setInterval(() => {}, 1000);`,
    ],
    { stdio: ["ignore", "pipe", "ignore"] }
  );

  // Read stdout until a full line parses as a positive integer. Under parallel
  // test load the first chunk can be empty or split mid-line (e.g. "1234\n" can
  // arrive as "12" + "34\n"), so a single `once("data")` can yield a partial
  // number that parses to a valid but WRONG pid, or NaN. Drain line-by-line,
  // only accepting lines that were terminated by `\n` to avoid the partial-line
  // footgun. Note: the grandchild's stdio is "ignore", so it cannot emit to
  // this pipe — `console.log(child.pid)` is the only source.
  let childPid = NaN;
  let pidTimer: NodeJS.Timeout | undefined;
  const pidDeadline = new Promise<number>((resolve) => {
    pidTimer = setTimeout(() => resolve(NaN), 5000);
  });
  const readPid = (async () => {
    let buf = "";
    for await (const chunk of parent.stdout!) {
      buf += chunk.toString();
      // Drop the trailing partial line (the one without a terminating newline)
      // so we never parse a half-delivered number.
      const lines = buf.split(/\r?\n/);
      const completeLines = buf.endsWith("\n") ? lines : lines.slice(0, -1);
      for (const line of completeLines) {
        const n = Number(line.trim());
        if (Number.isInteger(n) && n > 0) {
          return n;
        }
      }
    }
    return NaN;
  })();

  try {
    childPid = await Promise.race([readPid, pidDeadline]);

    assert.ok(parent.pid);
    assert.ok(
      Number.isInteger(childPid) && childPid > 0,
      `failed to read grandchild pid from parent stdout (buf parse yielded ${childPid})`
    );

    const killErr = killProcessTree(parent);
    assert.equal(killErr, null, `killProcessTree reported an error: ${killErr?.message}`);
    await waitForExit(parent);
    // Poll for up to ~1s instead of a fixed 500ms sleep — taskkill /F /T's
    // teardown is async and can exceed 500ms on slow Windows CI.
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline && (isProcessRunning(parent.pid!) || isProcessRunning(childPid))) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    assert.equal(isProcessRunning(parent.pid!), false);
    assert.equal(isProcessRunning(childPid), false);
  } finally {
    // Always clean up, even if the pid drain timed out and an assertion threw.
    // Without this the parent (and its grandchild, both running setInterval)
    // would leak as zombies for the lifetime of the test runner — exactly the
    // parallel-load scenario that motivated this rewrite.
    if (pidTimer) clearTimeout(pidTimer);
    try {
      if (parent.exitCode === null && !parent.killed) {
        killProcessTree(parent);
        await waitForExit(parent);
      }
    } catch {
      // best-effort cleanup
    }
  }
});

// Wait for a child to exit, but never hang: if the child already exited before
// we started waiting, the 'exit' event was emitted in the past and `once(exit)`
// would deadlock. Check `exitCode !== null` synchronously first.
function waitForExit(child: ChildProcess, timeoutMs = 3000): Promise<void> {
  if (child.exitCode !== null || child.killed) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
