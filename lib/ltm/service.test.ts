import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentMemoryRestBackend } from "./agentmemory-backend.ts";
import {
  defaultLtmConfig,
  getLtmConfig,
  mergeLtmConfig,
} from "./config.ts";
import {
  getMemoryService,
  MemoryService,
  resetMemoryServiceForTests,
} from "./service.ts";
import { projectIdFromCwd } from "./project-id.ts";

function withTempAgentDir(
  fn: (agentDir: string) => Promise<void> | void
): Promise<void> {
  const agentDir = mkdtempSync(join(tmpdir(), "ltm-svc-"));
  return Promise.resolve(fn(agentDir)).finally(() => {
    resetMemoryServiceForTests();
    rmSync(agentDir, { recursive: true, force: true });
  });
}

test("defaultLtmConfig uses agentDir/memory/ltm.sqlite", () => {
  const cfg = defaultLtmConfig("/tmp/agent");
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.backend, "sqlite");
  assert.equal(cfg.dbPath, join("/tmp/agent", "memory", "ltm.sqlite"));
  assert.equal(cfg.observeAgentEnd, true);
  assert.equal(cfg.observePreCompact, true);
  assert.equal(cfg.agentmemoryUrl, "http://127.0.0.1:3111");
});

test("getLtmConfig merges desktop-settings nested ltm", async () => {
  await withTempAgentDir((agentDir) => {
    writeFileSync(
      join(agentDir, "desktop-settings.json"),
      JSON.stringify({
        defaultAgentMode: "ask",
        defaultToolPreset: "default",
        ltm: {
          enabled: false,
          backend: "sqlite",
          observePreCompact: false,
          agentmemoryUrl: "http://127.0.0.1:4000",
        },
      }),
      "utf-8"
    );
    const cfg = getLtmConfig(agentDir);
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.backend, "sqlite");
    assert.equal(cfg.observePreCompact, false);
    assert.equal(cfg.observeAgentEnd, true);
    assert.equal(cfg.agentmemoryUrl, "http://127.0.0.1:4000");
    assert.equal(cfg.dbPath, join(agentDir, "memory", "ltm.sqlite"));
  });
});

test("mergeLtmConfig honors custom dbPath", () => {
  const cfg = mergeLtmConfig("/agent", { dbPath: "D:/data/custom.sqlite" });
  assert.equal(cfg.dbPath, "D:/data/custom.sqlite");
});

test("MemoryService.create remember/recall with temp agentDir", async () => {
  await withTempAgentDir(async (agentDir) => {
    const cfg = defaultLtmConfig(agentDir);
    const svc = MemoryService.create(cfg);
    try {
      const cwd = join(agentDir, "proj");
      mkdirSync(cwd, { recursive: true });

      const saved = await svc.rememberFromCwd(cwd, {
        content: "Prefer path resolve for session roots in LTM tests",
        type: "preference",
      });
      assert.match(saved.id, /^mem_/);
      assert.equal(saved.type, "preference");

      const hits = await svc.recallFromCwd(cwd, {
        query: "session roots",
        limit: 5,
      });
      assert.ok(hits.some((h) => h.kind === "memory"));

      const stats = await svc.statsFromCwd(cwd);
      assert.equal(stats.memoryCount, 1);
      assert.equal(stats.observationCount, 0);

      assert.equal(svc.isEnabled(), true);
      const health = await svc.health();
      assert.equal(health.ok, true);
      assert.equal(health.backend, "sqlite");
    } finally {
      await svc.close();
    }
  });
});

test("observeFromCwd no-ops when disabled; remember throws ltm_disabled", async () => {
  await withTempAgentDir(async (agentDir) => {
    const cfg = mergeLtmConfig(agentDir, { enabled: false });
    const svc = MemoryService.create(cfg);
    try {
      const cwd = join(agentDir, "proj");
      mkdirSync(cwd, { recursive: true });

      const obs = await svc.observeFromCwd(cwd, {
        sessionId: "s1",
        kind: "agent_end",
        title: "t",
        narrative: "should not persist",
      });
      assert.deepEqual(obs, { deduplicated: true });

      await assert.rejects(
        () =>
          svc.rememberFromCwd(cwd, {
            content: "x",
          }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.equal(err.message, "ltm_disabled");
          return true;
        }
      );

      await assert.rejects(
        () => svc.recallFromCwd(cwd, { query: "x" }),
        /ltm_disabled/
      );

      await assert.rejects(
        () => svc.forgetFromCwd(cwd, { memoryIds: ["mem_1"] }),
        /ltm_disabled/
      );

      const health = await svc.health();
      assert.equal(health.ok, false);
      assert.equal(health.detail, "ltm_disabled");
    } finally {
      await svc.close();
    }
  });
});

test("observeFromCwd persists when enabled", async () => {
  await withTempAgentDir(async (agentDir) => {
    const svc = MemoryService.create(defaultLtmConfig(agentDir));
    try {
      const cwd = join(agentDir, "proj");
      mkdirSync(cwd, { recursive: true });
      const result = await svc.observeFromCwd(cwd, {
        sessionId: "sess-1",
        kind: "pre_compact",
        title: "compact snapshot",
        narrative: "User asked about auth middleware patch",
      });
      assert.ok("observationId" in result);
      const hits = await svc.recallFromCwd(cwd, {
        query: "auth middleware",
        kinds: ["observation"],
      });
      assert.ok(hits.length >= 1);
      const stats = await svc.statsFromCwd(cwd);
      assert.equal(stats.observationCount, 1);
    } finally {
      await svc.close();
    }
  });
});

test("AgentMemoryRestBackend health is not_implemented; methods throw", async () => {
  const backend = new AgentMemoryRestBackend("http://127.0.0.1:3111");
  const health = await backend.health();
  assert.equal(health.ok, false);
  assert.equal(health.backend, "agentmemory");
  assert.equal(health.detail, "not_implemented");

  await assert.rejects(
    () =>
      backend.remember({
        projectId: "proj_x",
        content: "hi",
      }),
    /not implemented in v1/
  );
  await assert.rejects(
    () => backend.recall({ projectId: "proj_x", query: "hi" }),
    /not implemented/
  );
});

test("MemoryService with agentmemory backend health + throw", async () => {
  await withTempAgentDir(async (agentDir) => {
    const cfg = mergeLtmConfig(agentDir, { backend: "agentmemory" });
    const svc = MemoryService.create(cfg);
    try {
      const health = await svc.health();
      assert.equal(health.ok, false);
      assert.equal(health.detail, "not_implemented");
      await assert.rejects(
        () =>
          svc.rememberFromCwd(agentDir, {
            content: "x",
          }),
        /not implemented/
      );
    } finally {
      await svc.close();
    }
  });
});

test("getMemoryService singleton reuses same instance for same agentDir", async () => {
  await withTempAgentDir(async (agentDir) => {
    resetMemoryServiceForTests();
    const a = getMemoryService(agentDir);
    const b = getMemoryService(agentDir);
    assert.equal(a, b);
    assert.equal(a.isEnabled(), true);
    await a.close();
    resetMemoryServiceForTests();
  });
});

test("rememberFromCwd scopes by projectId from cwd", async () => {
  await withTempAgentDir(async (agentDir) => {
    const svc = MemoryService.create(defaultLtmConfig(agentDir));
    try {
      const cwdA = join(agentDir, "a");
      const cwdB = join(agentDir, "b");
      mkdirSync(cwdA, { recursive: true });
      mkdirSync(cwdB, { recursive: true });
      assert.notEqual(projectIdFromCwd(cwdA), projectIdFromCwd(cwdB));

      await svc.rememberFromCwd(cwdA, {
        content: "unique flamingo widget convention",
      });
      const hitsB = await svc.recallFromCwd(cwdB, {
        query: "flamingo widget",
      });
      assert.equal(hitsB.length, 0);
      const hitsA = await svc.recallFromCwd(cwdA, {
        query: "flamingo widget",
      });
      assert.ok(hitsA.length >= 1);
    } finally {
      await svc.close();
    }
  });
});
