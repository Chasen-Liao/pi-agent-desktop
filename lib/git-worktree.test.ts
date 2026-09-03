import test from "node:test";
import assert from "node:assert/strict";
import {
  createGitWorktree,
  GitWorktreeError,
  validateWorktreeBranchName,
  type GitRunner,
} from "./git-worktree.ts";

const identityRealpath = (path: string) => path;

function scriptedRunner(
  handler: (args: string[], cwd: string) => { code?: number; stdout?: string; stderr?: string }
): GitRunner {
  return async (args, { cwd }) => {
    const result = handler(args, cwd);
    return {
      code: result.code ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };
}

test("validateWorktreeBranchName rejects unsafe branch names", () => {
  assert.match(validateWorktreeBranchName("  ") ?? "", /empty/);
  assert.match(validateWorktreeBranchName("-danger") ?? "", /start/);
  assert.match(validateWorktreeBranchName("feature..bad") ?? "", /\.\./);
  assert.match(validateWorktreeBranchName("feature@{bad") ?? "", /@\{/);
  assert.match(validateWorktreeBranchName("feature bad") ?? "", /characters/);
  assert.match(validateWorktreeBranchName("feature/") ?? "", /end/);
  assert.equal(validateWorktreeBranchName("pi-agent/worktree-123"), null);
});

test("createGitWorktree creates a new branch in a sibling worktree", async () => {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const runner = scriptedRunner((args, cwd) => {
    calls.push({ args, cwd });
    if (args[0] === "rev-parse") {
      return { stdout: "/workspace/project\n" };
    }
    return {};
  });

  const result = await createGitWorktree(
    {
      sourceCwd: "/workspace/project/packages/app",
      branchName: "pi-agent/refactor-ui",
    },
    { runner, pathExists: () => false, realpath: identityRealpath }
  );

  assert.deepEqual(result, {
    cwd: "/workspace/project-pi-agent-refactor-ui",
    branchName: "pi-agent/refactor-ui",
    repoRoot: "/workspace/project",
  });
  assert.deepEqual(calls[0]?.args, ["rev-parse", "--show-toplevel"]);
  assert.deepEqual(calls[1]?.args, [
    "check-ref-format",
    "--branch",
    "pi-agent/refactor-ui",
  ]);
  assert.deepEqual(calls[2]?.args, [
    "worktree",
    "add",
    "-b",
    "pi-agent/refactor-ui",
    "/workspace/project-pi-agent-refactor-ui",
    "HEAD",
  ]);
});

test("createGitWorktree resolves a relative target beside the repository", async () => {
  const runner = scriptedRunner((args) =>
    args[0] === "rev-parse" ? { stdout: "/workspace/project\n" } : {}
  );

  const result = await createGitWorktree(
    {
      sourceCwd: "/workspace/project",
      targetCwd: "isolated-copy",
      branchName: "pi-agent/isolated-copy",
    },
    { runner, pathExists: () => false, realpath: identityRealpath }
  );

  assert.equal(result.cwd, "/workspace/isolated-copy");
});

test("createGitWorktree rejects a target inside the source repository", async () => {
  const runner = scriptedRunner((args) =>
    args[0] === "rev-parse" ? { stdout: "/workspace/project\n" } : {}
  );

  await assert.rejects(
    createGitWorktree(
      {
        sourceCwd: "/workspace/project",
        targetCwd: "/workspace/project/.worktrees/feature",
        branchName: "pi-agent/feature",
      },
      { runner, pathExists: () => false, realpath: identityRealpath }
    ),
    (error: unknown) =>
      error instanceof GitWorktreeError && error.code === "TARGET_INSIDE_REPOSITORY"
  );
});

test("createGitWorktree rejects a symlinked parent that resolves inside the source repository", async () => {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const runner = scriptedRunner((args, cwd) => {
    calls.push({ args, cwd });
    return args[0] === "rev-parse" ? { stdout: "/workspace/project\n" } : {};
  });

  await assert.rejects(
    createGitWorktree(
      {
        sourceCwd: "/workspace/project",
        targetCwd: "/outside/link/new-worktree",
        branchName: "pi-agent/symlink-check",
      },
      {
        runner,
        pathExists: () => false,
        realpath: (path) => (path === "/outside/link" ? "/workspace/project" : path),
      }
    ),
    (error: unknown) =>
      error instanceof GitWorktreeError && error.code === "TARGET_INSIDE_REPOSITORY"
  );

  assert.equal(calls.some(({ args }) => args[0] === "worktree"), false);
});

test("createGitWorktree rejects an existing target directory", async () => {
  const runner = scriptedRunner((args) =>
    args[0] === "rev-parse" ? { stdout: "/workspace/project\n" } : {}
  );

  await assert.rejects(
    createGitWorktree(
      {
        sourceCwd: "/workspace/project",
        targetCwd: "/workspace/project-copy",
        branchName: "pi-agent/copy",
      },
      { runner, pathExists: () => true, realpath: identityRealpath }
    ),
    (error: unknown) =>
      error instanceof GitWorktreeError && error.code === "TARGET_EXISTS"
  );
});

test("createGitWorktree reports non-git source directories", async () => {
  const runner = scriptedRunner(() => ({
    code: 128,
    stderr: "fatal: not a git repository",
  }));

  await assert.rejects(
    createGitWorktree(
      { sourceCwd: "/workspace/plain", branchName: "pi-agent/test" },
      { runner, pathExists: () => false, realpath: identityRealpath }
    ),
    (error: unknown) =>
      error instanceof GitWorktreeError && error.code === "NOT_GIT_REPOSITORY"
  );
});

test("createGitWorktree surfaces git worktree creation failures", async () => {
  const runner = scriptedRunner((args) => {
    if (args[0] === "rev-parse") return { stdout: "/workspace/project\n" };
    if (args[0] === "worktree") {
      return { code: 128, stderr: "fatal: a branch named 'pi-agent/test' already exists" };
    }
    return {};
  });

  await assert.rejects(
    createGitWorktree(
      { sourceCwd: "/workspace/project", branchName: "pi-agent/test" },
      { runner, pathExists: () => false, realpath: identityRealpath }
    ),
    (error: unknown) => {
      assert.ok(error instanceof GitWorktreeError);
      assert.equal(error.code, "WORKTREE_CREATE_FAILED");
      assert.match(error.message, /already exists/);
      return true;
    }
  );
});
