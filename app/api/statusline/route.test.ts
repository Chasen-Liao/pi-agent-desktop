import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";
import { GET } from "./route.ts";

/**
 * The status line route backs the /statusline slash command.
 *
 * It shells out to git, so the cases below run against a real throwaway
 * repository instead of a stub — the point is to pin the response contract
 * the UI consumes.
 */

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-statusline-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "--initial-branch=main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(dir, "README.md"), "# hello\n");
  git("add", ".");
  git("commit", "-m", "initial commit");
  return dir;
}

test("GET /api/statusline requires a cwd", async () => {
  const res = await GET(new Request("http://localhost/api/statusline"));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string };
  assert.match(body.error ?? "", /cwd/);
});

test("GET /api/statusline rejects a cwd outside the allowed roots", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-statusline-denied-"));
  try {
    const res = await GET(
      new Request(`http://localhost/api/statusline?cwd=${encodeURIComponent(dir)}`)
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? "", /not in allowed roots/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/statusline reports the git state of an allowed directory", async () => {
  const dir = makeGitRepo();
  try {
    // The allowed-roots set is derived from the pi sessions on disk; a repo
    // under the temp dir is not in it, so grant the root explicitly.
    const previous = process.env.PI_CODING_AGENT_DIR;
    const agentDir = mkdtempSync(join(tmpdir(), "pi-statusline-agent-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      const { getAllowedRoots } = await import("../../../lib/allowed-roots.ts");
      const roots = await getAllowedRoots();
      roots.add(dir);

      const res = await GET(
        new Request(`http://localhost/api/statusline?cwd=${encodeURIComponent(dir)}`)
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        cwd?: string;
        isRepo?: boolean;
        branch?: string;
        modified?: number;
        staged?: number;
        untracked?: number;
        lastCommit?: { hash?: string; subject?: string };
      };

      assert.equal(body.cwd, dir);
      assert.equal(body.isRepo, true);
      assert.equal(body.branch, "main");
      assert.equal(body.modified, 0);
      assert.equal(body.staged, 0);
      assert.equal(body.untracked, 0);
      assert.match(body.lastCommit?.hash ?? "", /^[0-9a-f]{7,}$/);
      assert.equal(body.lastCommit?.subject, "initial commit");
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
      rmSync(agentDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/statusline counts uncommitted changes", async () => {
  const dir = makeGitRepo();
  try {
    writeFileSync(join(dir, "new.txt"), "new\n");
    const previous = process.env.PI_CODING_AGENT_DIR;
    const agentDir = mkdtempSync(join(tmpdir(), "pi-statusline-agent-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      const { getAllowedRoots } = await import("../../../lib/allowed-roots.ts");
      const roots = await getAllowedRoots();
      roots.add(dir);

      const res = await GET(
        new Request(`http://localhost/api/statusline?cwd=${encodeURIComponent(dir)}`)
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { untracked?: number; modified?: number };
      assert.equal(body.untracked, 1);
      assert.equal(body.modified, 0);
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
      rmSync(agentDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
