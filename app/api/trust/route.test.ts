import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GET, POST } from "./route.ts";

/**
 * Route-level coverage for the project-trust handshake.
 *
 * The decision logic itself is covered in lib/project-trust-desktop.test.ts;
 * what matters here is that the HTTP surface answers 400 for malformed input
 * and reports the gate result instead of silently proceeding.
 *
 * Every case runs against an isolated agent dir. Without it the real
 * ~/.pi/agent trust store is consulted, and a project that inherits trust
 * from a previously trusted parent would report "proceed" instead of "prompt".
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

test("POST /api/trust rejects a missing cwd", async () => {
  const res = await POST(
    new Request("http://localhost/api/trust", {
      method: "POST",
      body: JSON.stringify({ optionId: "trust" }),
    })
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? "", /cwd/);
});

test("POST /api/trust rejects an unknown optionId", async () => {
  const res = await POST(
    new Request("http://localhost/api/trust", {
      method: "POST",
      body: JSON.stringify({ cwd: "/tmp/whatever", optionId: "maybe" }),
    })
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? "", /optionId/);
});

test("POST /api/trust applies a valid decision", async () => {
  await withIsolatedAgentDir(async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-trust-route-"));
    try {
      const project = makeProjectWithSkill(dir);
      const res = await POST(
        new Request("http://localhost/api/trust", {
          method: "POST",
          body: JSON.stringify({ cwd: project, optionId: "trust-session" }),
        })
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { success?: boolean; trusted?: boolean; persisted?: boolean };
      assert.equal(body.success, true);
      assert.equal(body.trusted, true);
      // Session-only decisions are not written to disk.
      assert.equal(body.persisted, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("GET /api/trust requires a cwd", async () => {
  const res = await GET(new Request("http://localhost/api/trust"));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? "", /cwd/);
});

test("GET /api/trust reports the gate for an untrusted project", async () => {
  await withIsolatedAgentDir(async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-trust-route-get-"));
    try {
      const project = makeProjectWithSkill(dir);
      const res = await GET(
        new Request(`http://localhost/api/trust?cwd=${encodeURIComponent(project)}`)
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        action?: string;
        trusted?: boolean;
        payload?: { needsTrust?: boolean; cwd?: string; options?: unknown[] };
      };
      assert.equal(body.action, "prompt");
      assert.equal(body.payload?.needsTrust, true);
      assert.equal(body.payload?.cwd, project);
      assert.ok((body.payload?.options?.length ?? 0) >= 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
