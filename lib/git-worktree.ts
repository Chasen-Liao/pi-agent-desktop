import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

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

export interface GitWorktreeCleanupTarget {
  worktree: GitWorktreeResult;
  removeBranch: boolean;
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
  readonly cleanupTarget?: GitWorktreeCleanupTarget;

  constructor(
    code: GitWorktreeErrorCode,
    message: string,
    originalError?: unknown,
    cleanupTarget?: GitWorktreeCleanupTarget
  ) {
    super(message);
    this.name = "GitWorktreeError";
    this.code = code;
    this.originalError = originalError;
    this.cleanupTarget = cleanupTarget;
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

function isErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: unknown }).code === code
  );
}

function canonicalLockKey(resourceKey: string): string {
  const normalized = resolve(resourceKey);
  return process.platform === "win32" || process.platform === "darwin"
    ? normalized.toLowerCase()
    : normalized;
}

function interprocessLockPath(resourceKey: string): string {
  const key = createHash("sha256").update(canonicalLockKey(resourceKey)).digest("hex");
  return join(tmpdir(), "pi-agent-desktop-worktree-locks", key);
}

function removeStaleInterprocessLock(lockPath: string): boolean {
  let lockAgeMs = 0;
  try {
    lockAgeMs = Date.now() - statSync(lockPath).mtimeMs;
  } catch (error) {
    return isErrorCode(error, "ENOENT");
  }
  if (lockAgeMs < 30_000) return false;

  const quarantinePath = `${lockPath}.stale-${randomUUID()}`;
  try {
    renameSync(lockPath, quarantinePath);
  } catch (error) {
    return isErrorCode(error, "ENOENT");
  }

  try {
    rmSync(quarantinePath, { recursive: true, force: true });
  } catch {
    // The lock was atomically quarantined; a later pass can finish removal.
  }
  return true;
}

async function acquireInterprocessLock(resourceKey: string): Promise<() => void> {
  const lockPath = interprocessLockPath(resourceKey);
  mkdirSync(dirname(lockPath), { recursive: true });

  while (true) {
    const token = randomUUID();
    let created = false;
    try {
      mkdirSync(lockPath);
      created = true;
      writeFileSync(
        join(lockPath, "owner"),
        JSON.stringify({ pid: process.pid, token }),
        { flag: "wx" }
      );
      const heartbeat = setInterval(() => {
        try {
          const owner = JSON.parse(readFileSync(join(lockPath, "owner"), "utf8")) as {
            token?: unknown;
          };
          if (owner.token !== token) {
            clearInterval(heartbeat);
            return;
          }
          const now = new Date();
          utimesSync(lockPath, now, now);
        } catch {
          // The lock may have been reclaimed after a process or filesystem failure.
        }
      }, 5_000);
      heartbeat.unref?.();
      return () => {
        clearInterval(heartbeat);
        try {
          const owner = JSON.parse(readFileSync(join(lockPath, "owner"), "utf8")) as {
            token?: unknown;
          };
          if (owner.token === token) {
            rmSync(lockPath, { recursive: true, force: true });
          }
        } catch {
          // The lock was already reclaimed or removed.
        }
      };
    } catch (error) {
      if (created) {
        rmSync(lockPath, { recursive: true, force: true });
      }
      if (!isErrorCode(error, "EEXIST")) throw error;
      if (!removeStaleInterprocessLock(lockPath)) {
        await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 25));
      }
    }
  }
}

async function withWorktreeLocks<T>(
  resourceKeys: string[],
  operation: () => Promise<T>
): Promise<T> {
  const keys = [...new Set(resourceKeys.map(canonicalLockKey))].sort();
  const locks = getWorktreeLocks();
  const previous = keys.map((key) => locks.get(key) ?? Promise.resolve());
  let release!: () => void;
  const current = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  for (const key of keys) locks.set(key, current);

  await Promise.all(previous);
  const releaseInterprocess: Array<() => void> = [];
  try {
    for (const key of keys) {
      releaseInterprocess.push(await acquireInterprocessLock(key));
    }
    return await operation();
  } finally {
    for (const releaseLock of releaseInterprocess.reverse()) releaseLock();
    release();
    for (const key of keys) {
      if (locks.get(key) === current) locks.delete(key);
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

type GitWorktreeDependencies = {
  runner?: GitRunner;
  pathExists?: (path: string) => boolean;
  sourcePathExists?: (path: string) => boolean;
  realpath?: (path: string) => string;
  onCleanupError?: (error: unknown, target: GitWorktreeCleanupTarget) => void;
};

async function withCreatedGitWorktree<T>(
  options: CreateGitWorktreeOptions,
  operation: (worktree: GitWorktreeResult) => T | Promise<T>,
  deps: GitWorktreeDependencies = {}
): Promise<T> {
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

  return withWorktreeLocks([repoRoot, targetPath], async () => {
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
      const cleanupTarget: GitWorktreeCleanupTarget = {
        worktree: { cwd: targetPath, branchName, repoRoot },
        removeBranch: !branchExisted,
      };
      const cleanupError = await cleanupWorktreeWithRetry(cleanupTarget, runner);
      if (cleanupError) deps.onCleanupError?.(cleanupError, cleanupTarget);
      throw new GitWorktreeError(
        "WORKTREE_CREATE_FAILED",
        `Failed to create Git worktree${conciseGitError(created.stderr)}`,
        cleanupError,
        cleanupError ? cleanupTarget : undefined
      );
    }

    const worktree = { cwd: targetPath, branchName, repoRoot };
    try {
      return await operation(worktree);
    } catch (error) {
      const cleanupTarget = { worktree, removeBranch: true };
      const cleanupError = await cleanupWorktreeWithRetry(cleanupTarget, runner);
      if (cleanupError) deps.onCleanupError?.(cleanupError, cleanupTarget);
      throw error;
    }
  });
}

export async function createGitWorktree(
  options: CreateGitWorktreeOptions,
  deps: GitWorktreeDependencies = {}
): Promise<GitWorktreeResult> {
  return withCreatedGitWorktree(options, (worktree) => worktree, deps);
}

export async function withGitWorktree<T>(
  options: CreateGitWorktreeOptions,
  operation: (worktree: GitWorktreeResult) => T | Promise<T>,
  deps: GitWorktreeDependencies = {}
): Promise<T> {
  return withCreatedGitWorktree(options, operation, deps);
}

async function cleanupWorktreeWithRetry(
  cleanupTarget: GitWorktreeCleanupTarget,
  runner: GitRunner
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await removeGitWorktreeUnlocked(
        cleanupTarget.worktree,
        runner,
        { removeBranch: cleanupTarget.removeBranch }
      );
      return undefined;
    } catch (error) {
      lastError = error;
    }
  }
  return lastError;
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
  return withWorktreeLocks([worktree.repoRoot, worktree.cwd], () =>
    removeGitWorktreeUnlocked(worktree, runner, options)
  );
}
