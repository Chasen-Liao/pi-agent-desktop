import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { killProcessTree } from "./process-tree.ts";

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
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

  const [chunk] = (await once(parent.stdout!, "data")) as [Buffer];
  const childPid = Number(chunk.toString().trim());
  assert.ok(parent.pid);
  assert.ok(childPid);

  killProcessTree(parent);
  await once(parent, "exit");
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.equal(isProcessRunning(parent.pid!), false);
  assert.equal(isProcessRunning(childPid), false);
});
