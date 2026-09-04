import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  createGitWorktree,
  GitWorktreeError,
  type GitWorktreeCleanupTarget,
  removeGitWorktree,
  validateWorktreeBranchName,
  withGitWorktree,
  type GitRunner,
} from "./git-worktree.ts";

const fixturePath = (path: string) => resolve(path);
const identityRealpath = (path: string) => path;
const fakeWorktreeIdentity = {
  gitDir: fixturePath("/workspace/project/.git/worktrees/test"),
  head: "deadbeef",
};

function scriptedRunner(
  handler: (args: string[], cwd: string) => { code?: number; stdout?: string; stderr?: string }
): GitRunner {
  return async (args, { cwd }) => {
    const result = handler(args, cwd);
    const defaultIdentity =
      args[0] === "rev-parse" && args[1] === "--git-dir"
        ? "/workspace/project/.git/worktrees/test\n"
        : args[0] === "rev-parse" && args[1] === "HEAD"
          ? "deadbeef\n"
          : "";
    return {
      code: result.code ?? 0,
      stdout: result.stdout ?? defaultIdentity,
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
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
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
    cwd: fixturePath("/workspace/project-pi-agent-refactor-ui"),
    branchName: "pi-agent/refactor-ui",
    repoRoot: fixturePath("/workspace/project"),
    ...fakeWorktreeIdentity,
  });
  assert.deepEqual(calls[0]?.args, ["rev-parse", "--show-toplevel"]);
  assert.deepEqual(calls[1]?.args, [
    "check-ref-format",
    "--branch",
    "pi-agent/refactor-ui",
  ]);
  assert.deepEqual(calls[2]?.args, [
    "worktree",
    "list",
    "--porcelain",
    "-z",
  ]);
  assert.deepEqual(calls[3]?.args, [
    "worktree",
    "add",
    "--no-checkout",
    "-b",
    "pi-agent/refactor-ui",
    fixturePath("/workspace/project-pi-agent-refactor-ui"),
    "HEAD",
  ]);
  assert.deepEqual(calls[4]?.args, ["rev-parse", "--git-dir"]);
  assert.deepEqual(calls[5]?.args, ["rev-parse", "HEAD"]);
  assert.deepEqual(calls[6]?.args, ["rev-parse", "--git-dir"]);
  assert.deepEqual(calls[7]?.args, ["rev-parse", "HEAD"]);
  assert.deepEqual(calls[8]?.args, ["checkout", "--force", "HEAD"]);
});

test("removeGitWorktree removes the worktree and its branch", async () => {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  let listCalls = 0;
  const runner = scriptedRunner((args, cwd) => {
    calls.push({ args, cwd });
    if (args[0] === "worktree" && args[1] === "list") {
      listCalls += 1;
      if (listCalls > 1) return {};
      return {
        stdout:
          `worktree ${fixturePath("/workspace/project-copy")}\0` +
          "HEAD deadbeef\0" +
          "branch refs/heads/pi-agent/project-copy\0",
      };
    }
    return {};
  });
  const worktree = {
    cwd: fixturePath("/workspace/project-copy"),
    branchName: "pi-agent/project-copy",
    repoRoot: fixturePath("/workspace/project"),
    ...fakeWorktreeIdentity,
  };

  await removeGitWorktree(worktree, runner);

  assert.deepEqual(calls, [
    {
      args: ["worktree", "list", "--porcelain", "-z"],
      cwd: worktree.repoRoot,
    },
    {
      args: ["rev-parse", "--git-dir"],
      cwd: worktree.cwd,
    },
    {
      args: ["rev-parse", "HEAD"],
      cwd: worktree.cwd,
    },
    {
      args: ["worktree", "remove", "--force", worktree.cwd],
      cwd: worktree.repoRoot,
    },
    {
      args: ["worktree", "list", "--porcelain", "-z"],
      cwd: worktree.repoRoot,
    },
    {
      args: [
        "update-ref",
        "--no-deref",
        "-d",
        `refs/heads/${worktree.branchName}`,
        worktree.head,
      ],
      cwd: worktree.repoRoot,
    },
  ]);
});

test("createGitWorktree does not clean up unowned resources after add fails", async () => {
  const calls: string[][] = [];
  const runner = scriptedRunner((args) => {
    calls.push(args);
    if (args[0] === "rev-parse") return { stdout: "/workspace/project\n" };
    if (args[0] === "worktree" && args[1] === "add") {
      return { code: 128, stderr: "fatal: post-checkout hook failed" };
    }
    return {};
  });

  await assert.rejects(
    createGitWorktree(
      { sourceCwd: "/workspace/project", branchName: "pi-agent/partial" },
      { runner, pathExists: () => false, realpath: identityRealpath }
    ),
    (error: unknown) =>
      error instanceof GitWorktreeError && error.code === "WORKTREE_CREATE_FAILED"
  );

  assert.deepEqual(calls.at(-1), [
    "worktree",
    "add",
    "--no-checkout",
    "-b",
    "pi-agent/partial",
    fixturePath("/workspace/project-pi-agent-partial"),
    "HEAD",
  ]);
  assert.equal(calls.some((args) => args[1] === "remove"), false);
  assert.equal(calls.some((args) => args[0] === "branch"), false);
});

test("withGitWorktree retries failed cleanup and exposes its target", async () => {
  let removeAttempts = 0;
  let branchAttempts = 0;
  let listCalls = 0;
  let cleanupTarget: GitWorktreeCleanupTarget | undefined;
  const runner = scriptedRunner((args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { stdout: "/workspace/project\n" };
    }
    if (args[0] === "worktree" && args[1] === "add") return {};
    if (args[0] === "worktree" && args[1] === "remove") {
      removeAttempts += 1;
      return { code: 128, stderr: "fatal: cleanup is temporarily unavailable" };
    }
    if (args[0] === "worktree" && args[1] === "list") {
      listCalls += 1;
      return listCalls === 1
        ? {}
        : {
            code: 0,
            stdout:
              "worktree /workspace/project-pi-agent-retry-cleanup\0" +
              "HEAD deadbeef\0" +
              "branch refs/heads/pi-agent/retry-cleanup\0",
          };
    }
    if (args[0] === "branch") {
      branchAttempts += 1;
      return { code: 1, stderr: "error: branch cleanup is temporarily unavailable" };
    }
    return {};
  });

  await assert.rejects(
    withGitWorktree(
      { sourceCwd: "/workspace/project", branchName: "pi-agent/retry-cleanup" },
      async () => {
        throw new Error("operation failed");
      },
      {
        runner,
        pathExists: () => false,
        realpath: identityRealpath,
        onCleanupError: (_error, target) => {
          cleanupTarget = target;
        },
      }
    ),
    (error: unknown) => error instanceof Error && error.message === "operation failed"
  );
  assert.equal(removeAttempts, 2);
  assert.equal(branchAttempts, 0);
  assert.equal(cleanupTarget?.removeBranch, true);
  assert.equal(cleanupTarget?.worktree.branchName, "pi-agent/retry-cleanup");
});

test("withGitWorktree treats completed cleanup as idempotent", async () => {
  let removeAttempts = 0;
  let branchAttempts = 0;
  let listCalls = 0;
  const runner = scriptedRunner((args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { stdout: "/workspace/project\n" };
    }
    if (args[0] === "worktree" && args[1] === "add") return {};
    if (args[0] === "worktree" && args[1] === "remove") {
      removeAttempts += 1;
      return removeAttempts === 1 ? {} : { code: 128, stderr: "fatal: already removed" };
    }
    if (args[0] === "worktree" && args[1] === "list") {
      listCalls += 1;
      return listCalls === 2
        ? {
            code: 0,
            stdout:
              "worktree /workspace/project-pi-agent-idempotent-cleanup\0" +
              "HEAD deadbeef\0" +
              "branch refs/heads/pi-agent/idempotent-cleanup\0",
          }
        : { code: 0, stdout: "" };
    }
    if (args[0] === "update-ref") {
      branchAttempts += 1;
      return branchAttempts === 1 ? { code: 1, stderr: "error: temporary failure" } : {};
    }
    if (args[0] === "show-ref") return { code: 0 };
    return {};
  });

  await assert.rejects(
    withGitWorktree(
      { sourceCwd: "/workspace/project", branchName: "pi-agent/idempotent-cleanup" },
      async () => {
        throw new Error("operation failed");
      },
      { runner, pathExists: () => false, realpath: identityRealpath }
    ),
    (error: unknown) => error instanceof Error && error.message === "operation failed"
  );
  assert.equal(removeAttempts, 1);
  assert.equal(branchAttempts, 2);
});

test("createGitWorktree preserves a pre-existing branch after creation fails", async () => {
  const calls: string[][] = [];
  const runner = scriptedRunner((args) => {
    calls.push(args);
    if (args[0] === "rev-parse") return { stdout: "/workspace/project\n" };
    if (args[0] === "show-ref") return { code: 0 };
    if (args[0] === "worktree" && args[1] === "add") {
      return { code: 128, stderr: "fatal: a branch named 'pi-agent/existing' already exists" };
    }
    return {};
  });

  await assert.rejects(
    createGitWorktree(
      { sourceCwd: "/workspace/project", branchName: "pi-agent/existing" },
      { runner, pathExists: () => false, realpath: identityRealpath }
    ),
    (error: unknown) =>
      error instanceof GitWorktreeError && error.code === "WORKTREE_CREATE_FAILED"
  );

  assert.deepEqual(calls.at(-1), [
    "worktree",
    "add",
    "--no-checkout",
    "-b",
    "pi-agent/existing",
    fixturePath("/workspace/project-pi-agent-existing"),
    "HEAD",
  ]);
  assert.equal(calls.some((args) => args[1] === "remove"), false);
  assert.equal(calls.some((args) => args[0] === "branch"), false);
});

test("createGitWorktree rejects a stale registered target", async () => {
  const calls: string[][] = [];
  const targetCwd = fixturePath("/workspace/project-copy");
  const runner = scriptedRunner((args) => {
    calls.push(args);
    if (args[0] === "rev-parse") return { stdout: "/workspace/project\n" };
    if (args[0] === "worktree" && args[1] === "list") {
      return {
        stdout: `worktree ${targetCwd}\0branch refs/heads/pi-agent/stale\0`,
      };
    }
    return {};
  });

  await assert.rejects(
    createGitWorktree(
      { sourceCwd: "/workspace/project", targetCwd, branchName: "pi-agent/new" },
      { runner, pathExists: () => false, realpath: identityRealpath }
    ),
    (error: unknown) =>
      error instanceof GitWorktreeError && error.code === "TARGET_EXISTS"
  );
  assert.equal(calls.some((args) => args[0] === "show-ref"), false);
  assert.equal(calls.some((args) => args[0] === "worktree" && args[1] === "add"), false);
});

test("createGitWorktree does not remove a pre-existing branch worktree", async () => {
  const calls: string[][] = [];
  const runner = scriptedRunner((args) => {
    calls.push(args);
    if (args[0] === "rev-parse") return { stdout: "/workspace/project\n" };
    if (args[0] === "show-ref") return { code: 0 };
    if (args[0] === "worktree" && args[1] === "add") {
      return { code: 128, stderr: "fatal: branch is already checked out" };
    }
    if (args[0] === "worktree" && args[1] === "remove") {
      return { code: 128, stderr: "fatal: worktree is locked" };
    }
    if (args[0] === "worktree" && args[1] === "list") {
      return {
        stdout:
          "worktree /workspace/existing-worktree\0" +
          "branch refs/heads/pi-agent/existing\0",
      };
    }
    return {};
  });

  await assert.rejects(
    createGitWorktree(
      { sourceCwd: "/workspace/project", branchName: "pi-agent/existing" },
      { runner, pathExists: () => false, realpath: identityRealpath }
    ),
    (error: unknown) =>
      error instanceof GitWorktreeError && error.code === "WORKTREE_CREATE_FAILED"
  );
  assert.equal(calls.some((args) => args[0] === "branch"), false);
  assert.equal(
    calls.some((args) => args[0] === "worktree" && args[3] === "/workspace/existing-worktree"),
    false
  );
});

test("createGitWorktree does not delete a branch claimed after the preflight", async () => {
  const calls: string[][] = [];
  let listCalls = 0;
  const runner = scriptedRunner((args) => {
    calls.push(args);
    if (args[0] === "rev-parse") return { stdout: "/workspace/project\n" };
    if (args[0] === "worktree" && args[1] === "list") {
      listCalls += 1;
      return listCalls === 1
        ? {}
        : {
            stdout:
              "worktree /workspace/foreign-worktree\0" +
              "branch refs/heads/pi-agent/raced\0",
          };
    }
    if (args[0] === "worktree" && args[1] === "add") {
      return { code: 128, stderr: "fatal: a branch named 'pi-agent/raced' already exists" };
    }
    return {};
  });

  await assert.rejects(
    createGitWorktree(
      { sourceCwd: "/workspace/project", branchName: "pi-agent/raced" },
      { runner, pathExists: () => false, realpath: identityRealpath }
    ),
    (error: unknown) =>
      error instanceof GitWorktreeError && error.code === "WORKTREE_CREATE_FAILED"
  );
  assert.equal(calls.some((args) => args[0] === "branch"), false);
});

test("createGitWorktree serializes target allocation per repository", async () => {
  let targetExists = false;
  let activeAdds = 0;
  let maxActiveAdds = 0;
  const runner: GitRunner = async (args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { code: 0, stdout: "/workspace/project\n", stderr: "" };
    }
    if (args[0] === "rev-parse" && args[1] === "--git-dir") {
      return { code: 0, stdout: "/workspace/project/.git/worktrees/test\n", stderr: "" };
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return { code: 0, stdout: "deadbeef\n", stderr: "" };
    }
    if (args[0] === "worktree" && args[1] === "add") {
      activeAdds += 1;
      maxActiveAdds = Math.max(maxActiveAdds, activeAdds);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      targetExists = true;
      activeAdds -= 1;
    }
    if (args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const options = {
    sourceCwd: "/workspace/project",
    targetCwd: "/workspace/project-copy",
    branchName: "pi-agent/serialized",
  };
  const createOptions = {
    runner,
    pathExists: () => targetExists,
    realpath: identityRealpath,
  };

  const first = createGitWorktree(options, createOptions);
  const second = createGitWorktree(options, createOptions);
  await first;
  await assert.rejects(
    second,
    (error: unknown) =>
      error instanceof GitWorktreeError && error.code === "TARGET_EXISTS"
  );
  assert.equal(maxActiveAdds, 1);
});

test("removeGitWorktree does not delete a branch when worktree removal fails", async () => {
  const calls: string[][] = [];
  const runner = scriptedRunner((args) => {
    calls.push(args);
    if (args[0] === "worktree" && args[1] === "remove") {
      return { code: 128, stderr: "fatal: worktree is locked" };
    }
    if (args[0] === "worktree" && args[1] === "list") {
      return {
        stdout:
          `worktree ${fixturePath("/workspace/project-copy")}\0` +
          "HEAD deadbeef\0" +
          "branch refs/heads/pi-agent/project-copy\0",
      };
    }
    return {};
  });

  await assert.rejects(
    removeGitWorktree(
      {
        cwd: fixturePath("/workspace/project-copy"),
        branchName: "pi-agent/project-copy",
        repoRoot: fixturePath("/workspace/project"),
        ...fakeWorktreeIdentity,
      },
      runner
    ),
    (error: unknown) => {
      assert.ok(error instanceof GitWorktreeError);
      assert.equal(error.code, "WORKTREE_CLEANUP_FAILED");
      assert.match(error.message, /worktree is locked/);
      return true;
    }
  );
  assert.deepEqual(calls, [
    ["worktree", "list", "--porcelain", "-z"],
    ["rev-parse", "--git-dir"],
    ["rev-parse", "HEAD"],
    ["worktree", "remove", "--force", fixturePath("/workspace/project-copy")],
  ]);
});

test("removeGitWorktree reports a branch cleanup failure", async () => {
  const calls: string[][] = [];
  let listCalls = 0;
  const runner = scriptedRunner((args) => {
    calls.push(args);
    if (args[0] === "worktree" && args[1] === "list") {
      listCalls += 1;
      return listCalls === 1
        ? {
            stdout:
              `worktree ${fixturePath("/workspace/project-copy")}\0` +
              "HEAD deadbeef\0" +
              "branch refs/heads/pi-agent/project-copy\0",
          }
        : {};
    }
    if (args[0] === "update-ref") {
      return { code: 1, stderr: "error: branch is still in use" };
    }
    if (args[0] === "show-ref") return { code: 0 };
    return {};
  });

  await assert.rejects(
    removeGitWorktree(
      {
        cwd: fixturePath("/workspace/project-copy"),
        branchName: "pi-agent/project-copy",
        repoRoot: fixturePath("/workspace/project"),
        ...fakeWorktreeIdentity,
      },
      runner
    ),
    (error: unknown) => {
      assert.ok(error instanceof GitWorktreeError);
      assert.equal(error.code, "WORKTREE_CLEANUP_FAILED");
      assert.match(error.message, /branch is still in use/);
      return true;
    }
  );
  assert.deepEqual(calls, [
    ["worktree", "list", "--porcelain", "-z"],
    ["rev-parse", "--git-dir"],
    ["rev-parse", "HEAD"],
    ["worktree", "remove", "--force", fixturePath("/workspace/project-copy")],
    ["worktree", "list", "--porcelain", "-z"],
    [
      "update-ref",
      "--no-deref",
      "-d",
      "refs/heads/pi-agent/project-copy",
      "deadbeef",
    ],
    ["show-ref", "--verify", "--quiet", "refs/heads/pi-agent/project-copy"],
  ]);
});

test("removeGitWorktree rejects a detached registered worktree", async () => {
  const calls: string[][] = [];
  const targetCwd = fixturePath("/workspace/project-copy");
  let removeAttempts = 0;
  const runner = scriptedRunner((args) => {
    calls.push(args);
    if (args[0] === "worktree" && args[1] === "remove") {
      removeAttempts += 1;
      return removeAttempts === 1 ? { code: 128, stderr: "fatal: already removed" } : {};
    }
    if (args[0] === "worktree" && args[1] === "list") {
      return { stdout: `worktree ${targetCwd}\0HEAD deadbeef\0detached\0` };
    }
    return {};
  });

  await assert.rejects(
    removeGitWorktree(
      {
        cwd: targetCwd,
        branchName: "pi-agent/detached",
        repoRoot: fixturePath("/workspace/project"),
        ...fakeWorktreeIdentity,
      },
      runner
    ),
    (error: unknown) =>
      error instanceof GitWorktreeError && error.code === "WORKTREE_CLEANUP_FAILED"
  );

  assert.deepEqual(calls, [["worktree", "list", "--porcelain", "-z"]]);
});

test("removeGitWorktree does not remove a different registered worktree", async () => {
  const calls: string[][] = [];
  const runner = scriptedRunner((args) => {
    calls.push(args);
    if (args[0] === "worktree" && args[1] === "list") {
      return {
        stdout:
          "worktree /workspace/project-copy-renamed\0" +
          "branch refs/heads/pi-agent/case\0",
      };
    }
    return {};
  });

  await assert.rejects(
    removeGitWorktree(
      {
        cwd: fixturePath("/workspace/project-copy"),
        branchName: "pi-agent/case",
        repoRoot: fixturePath("/workspace/project"),
        ...fakeWorktreeIdentity,
      },
      runner
    ),
    (error: unknown) =>
      error instanceof GitWorktreeError && error.code === "WORKTREE_CLEANUP_FAILED"
  );

  assert.deepEqual(calls, [["worktree", "list", "--porcelain", "-z"]]);
});

test("createGitWorktree resolves a relative target beside the repository", async () => {
  const runner = scriptedRunner((args) =>
    args[0] === "rev-parse" && args[1] === "--show-toplevel"
      ? { stdout: "/workspace/project\n" }
      : {}
  );

  const result = await createGitWorktree(
    {
      sourceCwd: "/workspace/project",
      targetCwd: "isolated-copy",
      branchName: "pi-agent/isolated-copy",
    },
    { runner, pathExists: () => false, realpath: identityRealpath }
  );

  assert.equal(result.cwd, fixturePath("/workspace/isolated-copy"));
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
        realpath: (path) =>
          path === fixturePath("/outside/link") ? fixturePath("/workspace/project") : path,
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

test("createGitWorktree reports missing source directories as repository errors", async () => {
  const runner: GitRunner = async () => {
    throw Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
  };

  await assert.rejects(
    createGitWorktree(
      { sourceCwd: "/workspace/missing-source", branchName: "pi-agent/missing-source" },
      { runner, sourcePathExists: () => false }
    ),
    (error: unknown) => {
      assert.ok(error instanceof GitWorktreeError);
      assert.equal(error.code, "NOT_GIT_REPOSITORY");
      assert.match(error.message, /does not exist/);
      return true;
    }
  );
});

test("createGitWorktree preserves Git unavailable errors for existing sources", async () => {
  const runner: GitRunner = async () => {
    throw Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
  };

  await assert.rejects(
    createGitWorktree(
      { sourceCwd: "/workspace/project", branchName: "pi-agent/git-unavailable" },
      { runner, sourcePathExists: () => true }
    ),
    (error: unknown) =>
      error instanceof GitWorktreeError && error.code === "GIT_UNAVAILABLE"
  );
});

test("createGitWorktree surfaces git worktree creation failures", async () => {
  const runner = scriptedRunner((args) => {
    if (args[0] === "rev-parse") return { stdout: "/workspace/project\n" };
    if (args[0] === "worktree" && args[1] === "add") {
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
