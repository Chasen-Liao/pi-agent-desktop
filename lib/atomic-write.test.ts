import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Worker } from "node:worker_threads";
import { writeFileAtomic } from "./atomic-write.ts";

test("writeFileAtomic writes complete content and replaces old content", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atomic-write-"));
  try {
    const target = join(dir, "settings.json");
    writeFileSync(target, "x".repeat(4096));
    writeFileAtomic(target, '{"n": 1}');
    assert.equal(readFileSync(target, "utf-8"), '{"n": 1}');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A reader handle open on the target makes renameSync fail with EPERM on
// Windows. The writer's retry loop blocks its own event loop, so only another
// thread can release the conflict mid-call — hence the worker thread.
test("writeFileAtomic retries rename while a reader holds the target open", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atomic-write-"));
  const worker = new Worker(
    `const { openSync, closeSync } = require("node:fs");
     const { parentPort, workerData } = require("node:worker_threads");
     const fd = openSync(workerData.target, "r");
     parentPort.postMessage("armed");
     setTimeout(() => {
       closeSync(fd);
       parentPort.postMessage("released");
     }, workerData.holdMs);`,
    { eval: true, workerData: { target: join(dir, "settings.json"), holdMs: 60 } },
  );
  try {
    const target = join(dir, "settings.json");
    writeFileSync(target, "old");
    await new Promise<void>((resolve) =>
      worker.once("message", (m: string) => m === "armed" && resolve()),
    );

    // Retry budget (200 x 5ms = 1s) comfortably covers the 60ms hold, so the
    // rename must succeed via the retry path, not the direct-write fallback.
    writeFileAtomic(target, '{"n": 2}', { retryIntervalMs: 5, maxRenameAttempts: 200 });
    assert.equal(readFileSync(target, "utf-8"), '{"n": 2}');

    await new Promise<void>((resolve) =>
      worker.once("message", (m: string) => m === "released" && resolve()),
    );
  } finally {
    await worker.terminate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeFileAtomic falls back to a direct write when rename stays blocked", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atomic-write-"));
  try {
    const target = join(dir, "settings.json");
    writeFileSync(target, "old");
    const fd = openSync(target, "r");
    try {
      // Deliberately tiny budget: the handle stays open for the whole call,
      // so the write must degrade to the direct path instead of throwing.
      writeFileAtomic(target, '{"n": 3}', {
        retryIntervalMs: 1,
        maxRenameAttempts: 2,
        sleepSync: () => {},
      });
      assert.equal(readFileSync(target, "utf-8"), '{"n": 3}');
    } finally {
      closeSync(fd);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
