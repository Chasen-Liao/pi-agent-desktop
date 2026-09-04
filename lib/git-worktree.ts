import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface GitCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (
  args: string[],
  options: { cwd: string }
) => Promise<GitCommandResult>;

export interface CreateGitWorktreeOptions {
  sourceCwd: string;
  targetCwd?: string;
  branchName?: string;
}

export interface GitWorktreeResult {
  cwd: string;
  branchName: string;
  repoRoot: string;
}

export type GitWorktreeErrorCode =
  | "GIT_UNAVAILABLE"
  | "NOT_GIT_REPOSITORY"
  | "INVALID_BRANCH"
  | "TARGET_INSIDE_REPOSITORY"
  | "TARGET_EXISTS"
  | "WORKTREE_CREATE_FAILED"
  | "WORKTREE_CLEANUP_FAILED";

export class GitWorktreeError extends Error {
  readonly code: GitWorktreeErrorCode;
  readonly originalError?: unknown;

  constructor(code: GitWorktreeErrorCode, message: string, originalError?: unknown) {
    super(message);
    this.name = "GitWorktreeError";
    this.code = code;
    this.originalError = originalError;
  }
}

function runGitProcess(args: string[], options: { cwd: string }): Promise<GitCommandResult> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: options.cwd,
        windowsHide: true,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error && error.code === "ENOENT") {
          reject(error);
          return;
        }
        resolvePromise({
          code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
          stdout,
          stderr,
        });
      }
    );
  });
}

const DEFAULT_GIT_RUNNER: GitRunner = runGitProcess;

function conciseGitError(stderr: string): string {
  const message = stderr.trim().split(/\r?\n/, 1)[0]?.trim();
  return message ? `: ${message.slice(0, 300)}` : "";
}

type WorktreeLockMap = Map<string, Promise<void>>;

declare global {
  var __piGitWorktreeLocks: WorktreeLockMap | undefined;
}

function getWorktreeLocks(): WorktreeLockMap {
  if (!globalThis.__piGitWorktreeLocks) {
    globalThis.__piGitWorktreeLocks = new Map();
  }
  return globalThis.__piGitWorktreeLocks;
}

async function withWorktreeLock<T>(repoRoot: string, operation: () => Promise<T>): Promise<T> {
  const locks = getWorktreeLocks();
  const previous = locks.get(repoRoot) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  locks.set(repoRoot, current);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(repoRoot) === current) {
      locks.delete(repoRoot);
    }
  }
}

async function runGit(
  runner: GitRunner,
  args: string[],
  cwd: string
): Promise<GitCommandResult> {
  try {
    return await runner(args, { cwd });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitWorktreeError(
      "GIT_UNAVAILABLE",
      `Unable to run Git${message ? `: ${message}` : ""}`,
      error
    );
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

function canonicalizeExistingPath(
  path: string,
  label: string,
  realpath: (path: string) => string
): string {
  try {
    return resolve(realpath(path));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitWorktreeError(
      "WORKTREE_CREATE_FAILED",
      `Unable to resolve ${label}${message ? `: ${message}` : ""}`
    );
  }
}

function generatedBranchName(): string {
  const stamp = Date.now().toString(36);
  return `pi-agent/worktree-${stamp}-${randomUUID().slice(0, 8)}`;
}

function branchPathSlug(branchName: string): string {
  const slug = branchName
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 72);
  return slug || `worktree-${randomUUID().slice(0, 8)}`;
}

export function validateWorktreeBranchName(branchName: string): string | null {
  const value = branchName.trim();
  if (!value) return "Branch name must not be empty";
  if (value.startsWith("-")) return "Branch name must not start with '-'";
  if (value.includes("..")) return "Branch name must not contain '..'";
  if (value.includes("@{")) return "Branch name must not contain '@{'";
  if (/[\u0000-\u0020~^:?*\\[\]]/.test(value)) {
    return "Branch name contains characters Git does not allow";
  }
  if (value.endsWith("/") || value.endsWith(".")) {
    return "Branch name must not end with '/' or '.'";
  }
  if (value.includes("//")) return "Branch name must not contain consecutive '/'";
  return null;
}

export async function resolveGitRoot(
  sourceCwd: string,
  runner: GitRunner = DEFAULT_GIT_RUNNER,
  sourcePathExists: (path: string) => boolean = existsSync
): Promise<string> {
  const cwd = resolve(sourceCwd);
  let result: GitCommandResult;
  try {
    result = await runGit(runner, ["rev-parse", "--show-toplevel"], cwd);
  } catch (error) {
    if (
      error instanceof GitWorktreeError &&
      error.code === "GIT_UNAVAILABLE" &&
      error.originalError instanceof Error &&
      "code" in error.originalError &&
      error.originalError.code === "ENOENT" &&
      !sourcePathExists(cwd)
    ) {
      throw new GitWorktreeError(
        "NOT_GIT_REPOSITORY",
        `Cannot create a worktree because ${cwd} does not exist`
      );
    }
    throw error;
  }
  const root = result.stdout.trim();
  if (result.code !== 0 || !root) {
    throw new GitWorktreeError(
      "NOT_GIT_REPOSITORY",
      `Cannot create a worktree because ${cwd} is not inside a Git repository${conciseGitError(result.stderr)}`
    );
  }
  return resolve(root);
}

export async function createGitWorktree(
  options: CreateGitWorktreeOptions,
  deps: {
    runner?: GitRunner;
    pathExists?: (path: string) => boolean;
    sourcePathExists?: (path: string) => boolean;
    realpath?: (path: string) => string;
  } = {}
): Promise<GitWorktreeResult> {
  const runner = deps.runner ?? DEFAULT_GIT_RUNNER;
  const pathExists = deps.pathExists ?? existsSync;
  const sourcePathExists = deps.sourcePathExists ?? existsSync;
  const realpath = deps.realpath ?? realpathSync;
  const resolvedRepoRoot = await resolveGitRoot(options.sourceCwd, runner, sourcePathExists);
  const repoRoot = canonicalizeExistingPath(resolvedRepoRoot, "repository root", realpath);
  const branchName = options.branchName?.trim() || generatedBranchName();

  const branchError = validateWorktreeBranchName(branchName);
  if (branchError) {
    throw new GitWorktreeError("INVALID_BRANCH", branchError);
  }

  const branchCheck = await runGit(
    runner,
    ["check-ref-format", "--branch", branchName],
    repoRoot
  );
  if (branchCheck.code !== 0) {
    throw new GitWorktreeError(
      "INVALID_BRANCH",
      `Invalid Git branch name '${branchName}'${conciseGitError(branchCheck.stderr)}`
    );
  }

  const targetCwd = options.targetCwd?.trim();
  const unresolvedTargetPath = targetCwd
    ? isAbsolute(targetCwd)
      ? resolve(targetCwd)
      : resolve(dirname(repoRoot), targetCwd)
    : resolve(dirname(repoRoot), `${basename(repoRoot)}-${branchPathSlug(branchName)}`);

  // realpath() the existing parent but preserve the final component because the
  // worktree directory itself must not exist yet. This prevents symlinked parent
  // directories from bypassing the repository-boundary check.
  const targetParent = canonicalizeExistingPath(
    dirname(unresolvedTargetPath),
    "worktree parent directory",
    realpath
  );
  const targetPath = resolve(targetParent, basename(unresolvedTargetPath));

  return withWorktreeLock(repoRoot, async () => {
    if (isWithin(repoRoot, targetPath)) {
      throw new GitWorktreeError(
        "TARGET_INSIDE_REPOSITORY",
        "Worktree directory must be outside the source repository"
      );
    }
    if (pathExists(targetPath)) {
      throw new GitWorktreeError(
        "TARGET_EXISTS",
        `Worktree directory already exists: ${targetPath}`
      );
    }

    const branchState = await runGit(
      runner,
      ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
      repoRoot
    );
    if (branchState.code !== 0 && branchState.code !== 1) {
      throw new GitWorktreeError(
        "WORKTREE_CREATE_FAILED",
        `Unable to check whether Git branch '${branchName}' exists${conciseGitError(branchState.stderr)}`
      );
    }
    const branchExisted = branchState.code === 0;

    const created = await runGit(
      runner,
      ["worktree", "add", "-b", branchName, targetPath, "HEAD"],
      repoRoot
    );
    if (created.code !== 0) {
      try {
        await removeGitWorktreeUnlocked(
          { cwd: targetPath, branchName, repoRoot },
          runner,
          { removeBranch: !branchExisted }
        );
      } catch {
        // Preserve the original creation error; cleanup is best effort here.
      }
      throw new GitWorktreeError(
        "WORKTREE_CREATE_FAILED",
        `Failed to create Git worktree${conciseGitError(created.stderr)}`
      );
    }

    return { cwd: targetPath, branchName, repoRoot };
  });
}

async function removeGitWorktreeUnlocked(
  worktree: GitWorktreeResult,
  runner: GitRunner,
  options: { removeBranch?: boolean } = {}
): Promise<void> {
  const errors: unknown[] = [];

  try {
    const removed = await runGit(
      runner,
      ["worktree", "remove", "--force", worktree.cwd],
      worktree.repoRoot
    );
    if (removed.code !== 0) {
      errors.push(
        new GitWorktreeError(
          "WORKTREE_CLEANUP_FAILED",
          `Failed to remove Git worktree${conciseGitError(removed.stderr)}`
        )
      );
    }
  } catch (error) {
    errors.push(error);
  }

  if (options.removeBranch !== false) {
    try {
      const branch = await runGit(
        runner,
        ["branch", "-D", worktree.branchName],
        worktree.repoRoot
      );
      if (branch.code !== 0) {
        errors.push(
          new GitWorktreeError(
            "WORKTREE_CLEANUP_FAILED",
            `Failed to remove Git worktree branch${conciseGitError(branch.stderr)}`
          )
        );
      }
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    const message = errors
      .map((error) => (error instanceof Error ? error.message : String(error)))
      .join("; ");
    throw new GitWorktreeError(
      "WORKTREE_CLEANUP_FAILED",
      `Failed to clean up Git worktree: ${message}`,
      errors[0]
    );
  }
}

export async function removeGitWorktree(
  worktree: GitWorktreeResult,
  runner: GitRunner = DEFAULT_GIT_RUNNER,
  options: { removeBranch?: boolean } = {}
): Promise<void> {
  return withWorktreeLock(worktree.repoRoot, () =>
    removeGitWorktreeUnlocked(worktree, runner, options)
  );
}
