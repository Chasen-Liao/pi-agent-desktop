import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
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

  // Read stdout until we see a line that parses as a positive integer. Under
  // parallel test load the first chunk can be empty or split mid-line, and a
  // delayed grandchild spawn can momentarily emit `undefined`. Drain lines
  // until the real pid shows up (or the parent exits / we time out).
  let childPid = NaN;
  const pidDeadline = new Promise((resolve) => setTimeout(resolve, 5000));
  const readPid = (async () => {
    let buf = "";
    for await (const chunk of parent.stdout!) {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      for (const line of lines) {
        const n = Number(line.trim());
        if (Number.isInteger(n) && n > 0) {
          return n;
        }
      }
    }
    return NaN;
  })();

  childPid = (await Promise.race([readPid, pidDeadline.then(() => NaN)])) as number;

  assert.ok(parent.pid);
  assert.ok(
    Number.isInteger(childPid) && childPid > 0,
    `failed to read grandchild pid from parent stdout (buf parse yielded ${childPid})`
  );

  killProcessTree(parent);
  await once(parent, "exit");
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.equal(isProcessRunning(parent.pid!), false);
  assert.equal(isProcessRunning(childPid), false);
});
