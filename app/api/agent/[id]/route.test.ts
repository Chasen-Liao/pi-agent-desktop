import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { POST } from "./route.ts";

/**
 * The 409 needsTrust handshake on an existing session.
 *
 * The route can only reach the trust gate after it resolved the session file
 * and read the cwd from its header, so the fixture builds a real session file
 * in the layout pi expects: <agentDir>/sessions/<encoded-cwd>/<name>.jsonl
 * with the session id carried by the header entry.
 */

function encodeSessionDir(cwd: string): string {
  const safePath = `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return safePath;
}

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

function makeUntrustedProject(root: string): string {
  const project = join(root, "proj");
  mkdirSync(join(project, ".pi", "skills"), { recursive: true });
  writeFileSync(join(project, ".pi", "skills", "x.md"), "# skill\n");
  return project;
}

function writeSessionFile(agentDir: string, cwd: string, id: string): void {
  const dir = join(agentDir, "sessions", encodeSessionDir(cwd));
  mkdirSync(dir, { recursive: true });
  const header = {
    type: "session",
    id,
    cwd,
    timestamp: new Date().toISOString(),
  };
  writeFileSync(join(dir, "2026-01-01T00-00-00_test.jsonl"), `${JSON.stringify(header)}\n`);
}

test("POST /api/agent/[id] returns 409 needsTrust for an untrusted project", async () => {
  await withIsolatedAgentDir(async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-agent-id-trust-"));
    try {
      const project = makeUntrustedProject(dir);
      const agentDir = process.env.PI_CODING_AGENT_DIR!;
      writeSessionFile(agentDir, project, "session-under-test");

      const res = await POST(
        new Request("http://localhost/api/agent/session-under-test", {
          method: "POST",
          body: JSON.stringify({ type: "prompt", message: "hi" }),
        }),
        { params: Promise.resolve({ id: "session-under-test" }) }
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

test("POST /api/agent/[id] answers 404 for an unknown session", async () => {
  await withIsolatedAgentDir(async () => {
    const res = await POST(
      new Request("http://localhost/api/agent/does-not-exist", {
        method: "POST",
        body: JSON.stringify({ type: "prompt", message: "hi" }),
      }),
      { params: Promise.resolve({ id: "does-not-exist" }) }
    );
    assert.equal(res.status, 404);
  });
});

test("POST /api/agent/[id] rejects an unknown command type before touching the session", async () => {
  await withIsolatedAgentDir(async () => {
    const res = await POST(
      new Request("http://localhost/api/agent/whatever", {
        method: "POST",
        body: JSON.stringify({ type: "not_a_command" }),
      }),
      { params: Promise.resolve({ id: "whatever" }) }
    );
    assert.equal(res.status, 400);
  });
});
