import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { cacheSessionPath } from "../../../../lib/session-reader.ts";
import { POST as branchSession } from "./branch/route.ts";
import { POST as cloneSession } from "./clone/route.ts";
import { GET as exportSession } from "./export/route.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = mkdtempSync(join(tmpdir(), "pi-routes-agent-"));

before(() => {
  // SessionManager.forkFrom() uses the default agent directory when cloning.
  // Keep route tests out of the developer's real ~/.pi session store.
  process.env.PI_CODING_AGENT_DIR = testAgentDir;
});

after(() => {
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }
  rmSync(testAgentDir, { recursive: true, force: true });
});

function createTestSession(dir: string, sessionCwd = dir) {
  const sm = SessionManager.create(sessionCwd, dir);
  const userMsgId = sm.appendMessage({ role: "user", content: "Hello world" } as never);
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "Hello back" }] } as never);
  (sm as unknown as { _rewriteFile?: () => void })._rewriteFile?.();

  const file = sm.getSessionFile()!;
  const id = sm.getSessionId();
  cacheSessionPath(id, file);

  return { sm, file, id, userMsgId };
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("POST /api/sessions/[id]/branch returns 404 for non-existent session", async () => {
  const req = new Request("http://localhost/api/sessions/non-existent/branch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetEntryId: "entry-1" }),
  });
  const res = await branchSession(req, { params: Promise.resolve({ id: "non-existent" }) });
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error, "Session not found");
  assert.equal(data.errorCode, "SESSION_NOT_FOUND");
});

test("POST /api/sessions/[id]/branch returns 400 for invalid payload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-branch-test-"));
  try {
    const { id } = createTestSession(dir);
    const req = new Request(`http://localhost/api/sessions/${id}/branch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await branchSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("targetEntryId"));
    assert.equal(data.errorCode, "INVALID_TARGET_ENTRY_ID");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/sessions/[id]/branch returns 400 for missing targetEntryId in session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-branch-test-"));
  try {
    const { id } = createTestSession(dir);
    const req = new Request(`http://localhost/api/sessions/${id}/branch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetEntryId: "invalid-entry-id" }),
    });
    const res = await branchSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, "Target entry not found");
    assert.equal(data.errorCode, "TARGET_ENTRY_NOT_FOUND");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/sessions/[id]/branch creates branched session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-branch-test-"));
  try {
    const { id, userMsgId } = createTestSession(dir);
    const req = new Request(`http://localhost/api/sessions/${id}/branch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetEntryId: userMsgId, name: "Branched Session" }),
    });
    const res = await branchSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(typeof data.sessionId, "string");
    assert.equal(typeof data.sessionFile, "string");

    const branchedSm = SessionManager.open(data.sessionFile, dir);
    assert.equal(branchedSm.getSessionName(), "Branched Session");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/sessions/[id]/clone returns 404 for non-existent session", async () => {
  const req = new Request("http://localhost/api/sessions/non-existent/clone", {
    method: "POST",
  });
  const res = await cloneSession(req, { params: Promise.resolve({ id: "non-existent" }) });
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.errorCode, "SESSION_NOT_FOUND");
});

test("POST /api/sessions/[id]/branch returns 400 for malformed JSON", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-branch-test-"));
  try {
    const { id } = createTestSession(dir);
    const req = new Request(`http://localhost/api/sessions/${id}/branch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    const res = await branchSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.errorCode, "INVALID_JSON_PAYLOAD");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/sessions/[id]/clone returns 400 for malformed JSON", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-clone-test-"));
  try {
    const { id } = createTestSession(dir);
    const req = new Request(`http://localhost/api/sessions/${id}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    const res = await cloneSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.errorCode, "INVALID_JSON_PAYLOAD");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/sessions/[id]/clone rejects a missing worktree source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-clone-test-"));
  try {
    const sourceCwd = join(dir, "missing-workspace");
    const { id } = createTestSession(dir, sourceCwd);
    const req = new Request(`http://localhost/api/sessions/${id}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceMode: "worktree", branchName: "pi-agent/missing-source" }),
    });
    const res = await cloneSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.errorCode, "NOT_GIT_REPOSITORY");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/sessions/[id]/clone creates a session in a Git worktree", async () => {
  const repoDir = mkdtempSync(join(tmpdir(), "pi-clone-worktree-test-"));
  const targetParent = mkdtempSync(join(tmpdir(), "pi-clone-worktree-target-"));
  const targetCwd = join(targetParent, "worktree");
  const branchName = "pi-agent/route-worktree";
  let clonedSessionFile: string | null = null;
  let worktreeCreated = false;
  try {
    const { id } = createTestSession(repoDir);
    runGit(repoDir, ["init"]);
    runGit(repoDir, ["add", "."]);
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Pi Route Test",
        "-c",
        "user.email=pi-route-test@example.com",
        "commit",
        "-m",
        "initial session",
      ],
      { cwd: repoDir, stdio: "ignore" }
    );

    const req = new Request(`http://localhost/api/sessions/${id}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceMode: "worktree",
        targetCwd,
        branchName,
        name: "Worktree Clone",
      }),
    });
    const res = await cloneSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.workspace.mode, "worktree");
    assert.equal(data.workspace.cwd, resolve(targetCwd));
    assert.equal(data.workspace.branchName, branchName);
    clonedSessionFile = data.sessionFile;
    worktreeCreated = true;

    const clonedSm = SessionManager.open(data.sessionFile, testAgentDir);
    assert.equal(clonedSm.getSessionName(), "Worktree Clone");
    assert.equal(clonedSm.getCwd(), resolve(targetCwd));
    assert.equal(resolve(runGit(targetCwd, ["rev-parse", "--show-toplevel"])), resolve(targetCwd));
    assert.equal(runGit(targetCwd, ["branch", "--show-current"]), branchName);
  } finally {
    if (clonedSessionFile) rmSync(clonedSessionFile, { force: true });
    if (worktreeCreated) {
      execFileSync("git", ["worktree", "remove", "--force", targetCwd], {
        cwd: repoDir,
        stdio: "ignore",
      });
    }
    rmSync(targetCwd, { recursive: true, force: true });
    rmSync(targetParent, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("POST /api/sessions/[id]/clone cleans up a worktree when forking fails", async () => {
  const repoDir = mkdtempSync(join(tmpdir(), "pi-clone-worktree-cleanup-test-"));
  const targetParent = mkdtempSync(join(tmpdir(), "pi-clone-worktree-cleanup-target-"));
  const blockerRoot = mkdtempSync(join(tmpdir(), "pi-clone-agent-blocker-"));
  const blockedAgentDir = join(blockerRoot, "agent-file");
  const targetCwd = join(targetParent, "worktree");
  const branchName = "pi-agent/route-cleanup";
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  writeFileSync(blockedAgentDir, "not a directory");

  try {
    const { id } = createTestSession(repoDir);
    runGit(repoDir, ["init"]);
    runGit(repoDir, ["add", "."]);
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Pi Route Test",
        "-c",
        "user.email=pi-route-test@example.com",
        "commit",
        "-m",
        "initial session",
      ],
      { cwd: repoDir, stdio: "ignore" }
    );
    process.env.PI_CODING_AGENT_DIR = blockedAgentDir;

    const req = new Request(`http://localhost/api/sessions/${id}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceMode: "worktree",
        targetCwd,
        branchName,
      }),
    });
    const res = await cloneSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.equal(data.errorCode, "CLONE_OPERATION_FAILED");
    assert.equal(existsSync(targetCwd), false);
    assert.equal(runGit(repoDir, ["branch", "--list", branchName]), "");
  } finally {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
    try {
      execFileSync("git", ["worktree", "remove", "--force", targetCwd], {
        cwd: repoDir,
        stdio: "ignore",
      });
    } catch {
      // The route should already have removed the worktree.
    }
    try {
      execFileSync("git", ["branch", "-D", branchName], {
        cwd: repoDir,
        stdio: "ignore",
      });
    } catch {
      // The route should already have removed the branch.
    }
    rmSync(targetCwd, { recursive: true, force: true });
    rmSync(targetParent, { recursive: true, force: true });
    rmSync(blockerRoot, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("POST /api/sessions/[id]/clone removes a partial fork file on failure", async () => {
  const repoDir = mkdtempSync(join(tmpdir(), "pi-clone-partial-session-test-"));
  const targetParent = mkdtempSync(join(tmpdir(), "pi-clone-partial-session-target-"));
  const targetCwd = join(targetParent, "worktree");
  const branchName = "pi-agent/partial-session-cleanup";
  const originalForkFrom = SessionManager.forkFrom;
  let partialSessionFile: string | null = null;
  const sessionManagerClass = SessionManager as typeof SessionManager & {
    forkFrom: typeof SessionManager.forkFrom;
  };

  try {
    const { id } = createTestSession(repoDir);
    runGit(repoDir, ["init"]);
    runGit(repoDir, ["add", "."]);
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Pi Route Test",
        "-c",
        "user.email=pi-route-test@example.com",
        "commit",
        "-m",
        "initial session",
      ],
      { cwd: repoDir, stdio: "ignore" }
    );

    sessionManagerClass.forkFrom = (...args) => {
      const sessionId = args[3]?.id;
      if (!sessionId) {
        throw new Error("test fork stub received incomplete arguments");
      }
      const partialSessionDir = join(testAgentDir, "sessions", "partial-fork");
      mkdirSync(partialSessionDir, { recursive: true });
      partialSessionFile = join(partialSessionDir, `partial_${sessionId}.jsonl`);
      writeFileSync(partialSessionFile, "partial session");
      throw new Error("forced fork copy failure");
    };

    const req = new Request(`http://localhost/api/sessions/${id}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceMode: "worktree",
        targetCwd,
        branchName,
      }),
    });
    const res = await cloneSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.equal(data.errorCode, "CLONE_OPERATION_FAILED");
    assert.ok(partialSessionFile);
    assert.equal(existsSync(partialSessionFile), false);
    assert.equal(existsSync(targetCwd), false);
    assert.equal(runGit(repoDir, ["branch", "--list", branchName]), "");
  } finally {
    sessionManagerClass.forkFrom = originalForkFrom;
    try {
      execFileSync("git", ["worktree", "remove", "--force", targetCwd], {
        cwd: repoDir,
        stdio: "ignore",
      });
    } catch {
      // The route should already have removed the worktree.
    }
    try {
      execFileSync("git", ["branch", "-D", branchName], {
        cwd: repoDir,
        stdio: "ignore",
      });
    } catch {
      // The route should already have removed the branch.
    }
    rmSync(targetCwd, { recursive: true, force: true });
    rmSync(targetParent, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("POST /api/sessions/[id]/clone removes a forked session file on failure", async () => {
  const repoDir = mkdtempSync(join(tmpdir(), "pi-clone-session-cleanup-test-"));
  const targetParent = mkdtempSync(join(tmpdir(), "pi-clone-session-cleanup-target-"));
  const targetCwd = join(targetParent, "worktree");
  const branchName = "pi-agent/session-cleanup";
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const originalForkFrom = SessionManager.forkFrom;
  const originalAppendSessionInfo = SessionManager.prototype.appendSessionInfo;
  let forkedSessionFile: string | null = null;
  const sessionManagerClass = SessionManager as typeof SessionManager & {
    forkFrom: typeof SessionManager.forkFrom;
  };
  const sessionManagerPrototype = SessionManager.prototype as SessionManager & {
    appendSessionInfo: (name: string) => string;
  };

  try {
    const { id } = createTestSession(repoDir);
    runGit(repoDir, ["init"]);
    runGit(repoDir, ["add", "."]);
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Pi Route Test",
        "-c",
        "user.email=pi-route-test@example.com",
        "commit",
        "-m",
        "initial session",
      ],
      { cwd: repoDir, stdio: "ignore" }
    );

    sessionManagerClass.forkFrom = (...args) => {
      const forkedSm = originalForkFrom.call(SessionManager, ...args);
      forkedSessionFile = forkedSm.getSessionFile() ?? null;
      return forkedSm;
    };
    sessionManagerPrototype.appendSessionInfo = (name) => {
      throw new Error(`forced append failure for ${name}`);
    };

    const req = new Request(`http://localhost/api/sessions/${id}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceMode: "worktree",
        targetCwd,
        branchName,
        name: "Will fail",
      }),
    });
    const res = await cloneSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.equal(data.errorCode, "CLONE_OPERATION_FAILED");
    assert.ok(forkedSessionFile);
    assert.equal(existsSync(forkedSessionFile), false);
    assert.equal(existsSync(targetCwd), false);
    assert.equal(runGit(repoDir, ["branch", "--list", branchName]), "");
  } finally {
    sessionManagerClass.forkFrom = originalForkFrom;
    sessionManagerPrototype.appendSessionInfo = originalAppendSessionInfo;
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
    try {
      execFileSync("git", ["worktree", "remove", "--force", targetCwd], {
        cwd: repoDir,
        stdio: "ignore",
      });
    } catch {
      // The route should already have removed the worktree.
    }
    try {
      execFileSync("git", ["branch", "-D", branchName], {
        cwd: repoDir,
        stdio: "ignore",
      });
    } catch {
      // The route should already have removed the branch.
    }
    rmSync(targetCwd, { recursive: true, force: true });
    rmSync(targetParent, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("POST /api/sessions/[id]/clone creates cloned session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-clone-test-"));
  let clonedSessionFile: string | null = null;
  let clonedSessionFileIsolated = false;
  try {
    const { id } = createTestSession(dir);
    const req = new Request(`http://localhost/api/sessions/${id}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cloned Session" }),
    });
    const res = await cloneSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(typeof data.sessionId, "string");
    assert.equal(typeof data.sessionFile, "string");
    clonedSessionFile = data.sessionFile;
    clonedSessionFileIsolated = data.sessionFile.startsWith(`${testAgentDir}${sep}`);
    assert.ok(
      clonedSessionFileIsolated,
      `clone escaped isolated agent directory: ${data.sessionFile}`
    );

    const clonedSm = SessionManager.open(data.sessionFile, dir);
    assert.equal(clonedSm.getSessionName(), "Cloned Session");
    assert.deepEqual(data.workspace, { mode: "directory", cwd: resolve(dir) });
  } finally {
    if (clonedSessionFile && clonedSessionFileIsolated) {
      rmSync(clonedSessionFile, { force: true });
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/sessions/[id]/export returns 404 for non-existent session", async () => {
  const req = new Request("http://localhost/api/sessions/non-existent/export?format=html");
  const res = await exportSession(req, { params: Promise.resolve({ id: "non-existent" }) });
  assert.equal(res.status, 404);
});

test("GET /api/sessions/[id]/export returns 400 for invalid format", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-export-test-"));
  try {
    const { id } = createTestSession(dir);
    const req = new Request(`http://localhost/api/sessions/${id}/export?format=invalid`);
    const res = await exportSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("Invalid export format"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/sessions/[id]/export exports HTML and Markdown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-export-test-"));
  try {
    const { id } = createTestSession(dir);

    // HTML export
    const reqHtml = new Request(`http://localhost/api/sessions/${id}/export?format=html`);
    const resHtml = await exportSession(reqHtml, { params: Promise.resolve({ id }) });
    assert.equal(resHtml.status, 200);
    assert.equal(resHtml.headers.get("content-type"), "text/html; charset=utf-8");
    const htmlBody = await resHtml.text();
    assert.ok(htmlBody.includes("<!DOCTYPE html>") || htmlBody.includes("<html"));

    // Markdown export with download header
    const reqMd = new Request(`http://localhost/api/sessions/${id}/export?format=markdown&download=true`);
    const resMd = await exportSession(reqMd, { params: Promise.resolve({ id }) });
    assert.equal(resMd.status, 200);
    assert.equal(resMd.headers.get("content-type"), "text/markdown; charset=utf-8");
    assert.equal(resMd.headers.get("content-disposition"), `attachment; filename="session-${id}.md"`);
    const mdBody = await resMd.text();
    assert.ok(mdBody.includes("## User"));
    assert.ok(mdBody.includes("Hello world"));
    assert.ok(mdBody.includes("## Assistant"));
    assert.ok(mdBody.includes("Hello back"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
