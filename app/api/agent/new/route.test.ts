import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { POST } from "./route.ts";

/**
 * The 409 needsTrust handshake at the session-start boundary.
 *
 * A project that ships its own skills or extensions must not be started
 * before the user trusted it — otherwise the trust prompt in the UI is purely
 * decorative. The agent dir is isolated so the real ~/.pi/agent trust store
 * cannot make the project look pre-trusted.
 */

async function withIsolatedAgentDir(fn: () => Promise<void>): Promise<void> {
  const previous = process.env.PI_CODING_AGENT_DIR;
  const agentDir = mkdtempSync(join(tmpdir(), "pi-agent-dir-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true });
  }
}

function makeProjectWithSkill(root: string): string {
  const project = join(root, "proj");
  mkdirSync(join(project, ".pi", "skills"), { recursive: true });
  writeFileSync(join(project, ".pi", "skills", "x.md"), "# skill\n");
  return project;
}

test("POST /api/agent/new returns 409 needsTrust for an untrusted project", async () => {
  await withIsolatedAgentDir(async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-agent-new-trust-"));
    try {
      const project = makeProjectWithSkill(dir);
      const res = await POST(
        new Request("http://localhost/api/agent/new", {
          method: "POST",
          body: JSON.stringify({ cwd: project, type: "prompt", message: "hi" }),
        })
      );

      assert.equal(res.status, 409);
      const body = (await res.json()) as {
        needsTrust?: boolean;
        cwd?: string;
        options?: { id?: string }[];
      };
      assert.equal(body.needsTrust, true);
      assert.equal(body.cwd, project);
      const ids = (body.options ?? []).map((o) => o.id);
      assert.ok(ids.includes("trust"));
      assert.ok(ids.includes("deny"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("POST /api/agent/new rejects a missing cwd before touching the trust gate", async () => {
  const res = await POST(
    new Request("http://localhost/api/agent/new", {
      method: "POST",
      body: JSON.stringify({ type: "prompt", message: "hi" }),
    })
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? "", /cwd/);
});

test("POST /api/agent/new rejects a directory that does not exist", async () => {
  const res = await POST(
    new Request("http://localhost/api/agent/new", {
      method: "POST",
      body: JSON.stringify({ cwd: join(tmpdir(), "pi-definitely-missing-dir"), type: "prompt", message: "hi" }),
    })
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? "", /does not exist/i);
});
