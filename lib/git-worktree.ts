import { execFile, execFileSync } from "node:child_process";
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
  gitDir: string;
  head: string;
  branchOwnerToken: string;
  ownerMarkerPath?: string;
  ownerToken?: string;
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
        env: { ...process.env, LC_ALL: "C", LANG: "C" },
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

type GitWorktreeListRecord = {
  cwd: string;
  branchName?: string;
  head?: string;
};

function parseGitWorktreeList(stdout: string): GitWorktreeListRecord[] {
  const records: GitWorktreeListRecord[] = [];
  let current: GitWorktreeListRecord | undefined;
  const addCurrent = () => {
    if (current) records.push(current);
    current = undefined;
  };

  for (const field of stdout.split("\0")) {
    if (field === "") {
      addCurrent();
    } else if (field.startsWith("worktree ")) {
      addCurrent();
      current = { cwd: field.slice(9) };
    } else if (field.startsWith("HEAD ") && current) {
      current.head = field.slice(5);
    } else if (field.startsWith("branch refs/heads/") && current) {
      current.branchName = field.slice("branch refs/heads/".length);
    }
  }
  addCurrent();
  return records;
}

type CanonicalComparisonPath = {
  path: string;
  complete: boolean;
};

function canonicalPathForComparison(input: string): CanonicalComparisonPath {
  const missingParts: string[] = [];
  let current = resolve(input);
  while (true) {
    try {
      const existing = realpathSync.native(current);
      return {
        path: resolve(join(existing, ...missingParts.reverse())),
        complete: missingParts.length === 0,
      };
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return { path: resolve(input), complete: false };
      }
      missingParts.push(basename(current));
      current = parent;
    }
  }
}

function pathsMatch(left: string, right: string): boolean | undefined {
  const leftPath = canonicalPathForComparison(left);
  const rightPath = canonicalPathForComparison(right);
  if (leftPath.path === rightPath.path) return true;
  if (!leftPath.complete || !rightPath.complete) {
    // A missing tail cannot establish whether a case-only spelling is the
    // same entry. Keep that comparison uncertain instead of deleting it.
    if (leftPath.path.toLowerCase() === rightPath.path.toLowerCase()) return undefined;
  }
  return false;
}

async function readWorktreeGitDir(runner: GitRunner, cwd: string): Promise<string> {
  try {
    const result = await runGit(runner, ["rev-parse", "--git-dir"], cwd);
    const gitDir = result.stdout.trim();
    if (result.code === 0 && gitDir) return resolve(cwd, gitDir);
  } catch {
    // Fall back to the linked worktree's .git file.
  }

  try {
    const gitFile = readFileSync(join(cwd, ".git"), "utf8").trim();
    const match = /^gitdir:\s*(.+)$/i.exec(gitFile);
    if (match?.[1]) return resolve(cwd, match[1].trim());
  } catch {
    // Report a stable library error below.
  }
  throw new GitWorktreeError(
    "WORKTREE_CREATE_FAILED",
    "Unable to record Git worktree identity"
  );
}

async function readWorktreeHead(runner: GitRunner, cwd: string): Promise<string> {
  const result = await runGit(runner, ["rev-parse", "HEAD"], cwd);
  const head = result.stdout.trim();
  if (result.code !== 0 || !head) {
    throw new GitWorktreeError(
      "WORKTREE_CREATE_FAILED",
      "Unable to record Git worktree identity"
    );
  }
  return head;
}

async function readWorktreeIdentity(
  runner: GitRunner,
  cwd: string
): Promise<{ gitDir: string; head: string }> {
  return {
    gitDir: await readWorktreeGitDir(runner, cwd),
    head: await readWorktreeHead(runner, cwd),
  };
}

// Git's ref CAS only compares the target OID, so a deleted and recreated
// branch at the same OID would otherwise look owned. The temporary commit
// creates a unique reflog transition that cleanup can verify before deletion.
const BRANCH_OWNER_MESSAGE_PREFIX = "pi-agent-desktop worktree owner";

function branchOwnerMessage(ownerToken: string): string {
  return `${BRANCH_OWNER_MESSAGE_PREFIX} ${ownerToken}`;
}

function isGitObjectId(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
}

function branchOwnerReflogMatches(
  stdout: string,
  head: string,
  ownerToken: string
): boolean {
  const [reflogHead, message] = stdout.trimEnd().split("\0");
  return reflogHead === head && message === branchOwnerMessage(ownerToken);
}

async function recordBranchOwnership(
  runner: GitRunner,
  repoRoot: string,
  branchName: string,
  head: string,
  ownerToken: string
): Promise<void> {
  const refName = `refs/heads/${branchName}`;
  const message = branchOwnerMessage(ownerToken);
  const markerCommit = await runGit(
    runner,
    [
      "-c",
      "user.name=pi-agent-desktop",
      "-c",
      "user.email=pi-agent-desktop@invalid",
      "-c",
      "commit.gpgSign=false",
      "commit-tree",
      `${head}^{tree}`,
      "-p",
      head,
      "-m",
      message,
    ],
    repoRoot
  );
  const markerHead = markerCommit.stdout.trim();
  if (markerCommit.code !== 0 || !isGitObjectId(markerHead)) {
    throw new GitWorktreeError(
      "WORKTREE_CREATE_FAILED",
      "Unable to record Git branch ownership"
    );
  }

  const moved = await runGit(
    runner,
    ["update-ref", "-m", message, refName, markerHead, head],
    repoRoot
  );
  if (moved.code !== 0) {
    throw new GitWorktreeError(
      "WORKTREE_CREATE_FAILED",
      "The Git worktree branch changed before ownership was recorded"
    );
  }

  const restored = await runGit(
    runner,
    ["update-ref", "-m", message, refName, head, markerHead],
    repoRoot
  );
  if (restored.code !== 0) {
    // Restore the original branch tip when the marker transaction is only
    // partially applied. The expected markerHead makes this rollback safe.
    await runGit(runner, ["update-ref", refName, head, markerHead], repoRoot).catch(() => {});
    throw new GitWorktreeError(
      "WORKTREE_CREATE_FAILED",
      "Unable to finish recording Git branch ownership"
    );
  }

  const reflog = await runGit(
    runner,
    ["reflog", "show", "--format=%H%x00%gs", "-1", refName],
    repoRoot
  );
  if (reflog.code !== 0 || !branchOwnerReflogMatches(reflog.stdout, head, ownerToken)) {
    throw new GitWorktreeError(
      "WORKTREE_CREATE_FAILED",
      "Git branch ownership cannot be proved"
    );
  }
}

async function assertBranchOwnership(
  runner: GitRunner,
  repoRoot: string,
  branchName: string,
  head: string,
  ownerToken: string
): Promise<void> {
  const refName = `refs/heads/${branchName}`;
  const reflog = await runGit(
    runner,
    ["reflog", "show", "--format=%H%x00%gs", "-1", refName],
    repoRoot
  );
  if (reflog.code !== 0 || !branchOwnerReflogMatches(reflog.stdout, head, ownerToken)) {
    throw new GitWorktreeError(
      "WORKTREE_CLEANUP_FAILED",
      "The Git branch ownership marker changed"
    );
  }
}

function findRegisteredWorktree(
  stdout: string,
  targetCwd: string
): { record?: GitWorktreeListRecord; uncertain: boolean } {
  const records = parseGitWorktreeList(stdout);
  let uncertain = false;
  for (const record of records) {
    const match = pathsMatch(record.cwd, targetCwd);
    if (match === true) return { record, uncertain: false };
    if (match === undefined) uncertain = true;
  }
  return { uncertain };
}

function hasRegisteredBranch(stdout: string, branchName: string): boolean {
  return parseGitWorktreeList(stdout).some((record) => record.branchName === branchName);
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

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrorCode(error, "EPERM");
  }
}

function processStartTime(pid: number): number | undefined {
  try {
    if (pid === process.pid) {
      return Date.now() - process.uptime() * 1_000;
    }
    if (process.platform === "win32") {
      const output = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${pid}).StartTime.ToFileTimeUtc()`,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 2_000 }
      );
      const fileTime = Number(output.trim());
      return Number.isFinite(fileTime) ? fileTime / 10_000 - 11_644_473_600_000 : undefined;
    }

    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
      const startTicks = Number(fields[19]);
      const bootTime = Number(
        readFileSync("/proc/stat", "utf8").match(/^btime (\d+)$/m)?.[1]
      );
      const clockTicks = Number(
        execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8", timeout: 2_000 }).trim()
      );
      if (!Number.isFinite(startTicks) || !Number.isFinite(bootTime) || !Number.isFinite(clockTicks)) {
        return undefined;
      }
      return bootTime * 1_000 + (startTicks * 1_000) / clockTicks;
    }

    if (process.platform === "darwin") {
      const output = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C", LANG: "C" },
        timeout: 2_000,
      });
      const startedAt = Date.parse(output.trim());
      return Number.isFinite(startedAt) ? startedAt : undefined;
    }
  } catch {
    // A process start time that cannot be verified must not be treated as safe.
  }
  return undefined;
}

function processInstanceMatches(pid: number, startedAt: number): boolean | undefined {
  const actualStartedAt = processStartTime(pid);
  if (actualStartedAt === undefined) return undefined;
  return Math.abs(actualStartedAt - startedAt) <= 2_000;
}

function removeStaleInterprocessLock(lockPath: string): boolean {
  let lockAgeMs = 0;
  try {
    lockAgeMs = Date.now() - statSync(lockPath).mtimeMs;
  } catch (error) {
    return isErrorCode(error, "ENOENT");
  }
  if (lockAgeMs < 30_000) return false;

  try {
    const owner = JSON.parse(readFileSync(join(lockPath, "owner"), "utf8")) as {
      pid?: unknown;
      startedAt?: unknown;
    };
    if (
      typeof owner.pid === "number" &&
      Number.isSafeInteger(owner.pid) &&
      owner.pid > 0 &&
      processIsAlive(owner.pid)
    ) {
      if (typeof owner.startedAt !== "number" || !Number.isFinite(owner.startedAt)) {
        return false;
      }
      // A live PID is not enough: the OS may have reused it. Reclaim only
      // when the recorded process start time is provably different.
      if (processInstanceMatches(owner.pid, owner.startedAt) !== false) {
        return false;
      }
    }
  } catch (error) {
    if (!isErrorCode(error, "ENOENT")) {
      // A stale or partially written owner file is safe to reclaim after the age check.
    }
  }

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
        JSON.stringify({
          pid: process.pid,
          startedAt: Date.now() - process.uptime() * 1_000,
          token,
        }),
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

async function cleanupUnidentifiedWorktree(
  runner: GitRunner,
  repoRoot: string,
  cwd: string,
  branchName: string,
  ownerMarkerPath?: string,
  ownerToken?: string,
  expectedHead?: string
): Promise<unknown> {
  if (!ownerMarkerPath || !ownerToken) {
    return new GitWorktreeError(
      "WORKTREE_CLEANUP_FAILED",
      "Unable to verify ownership of the newly created Git worktree"
    );
  }

  let lastError: unknown;
  let worktreeRemoved = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (!worktreeRemoved) {
        const listed = await runGit(
          runner,
          ["worktree", "list", "--porcelain", "-z"],
          repoRoot
        );
        if (listed.code !== 0) {
          lastError = new GitWorktreeError(
            "WORKTREE_CLEANUP_FAILED",
            `Unable to inspect Git worktrees${conciseGitError(listed.stderr)}`
          );
          continue;
        }
        const registered = findRegisteredWorktree(listed.stdout, cwd);
        if (registered.uncertain || !registered.record) {
          lastError = new GitWorktreeError(
            "WORKTREE_CLEANUP_FAILED",
            "Unable to verify ownership of the newly created Git worktree"
          );
          continue;
        }
        if (
          registered.record.branchName !== branchName ||
          !registered.record.head ||
          (expectedHead !== undefined && registered.record.head !== expectedHead)
        ) {
          return new GitWorktreeError(
            "WORKTREE_CLEANUP_FAILED",
            "The newly created Git worktree is no longer owned by this operation"
          );
        }
        try {
          if (readFileSync(ownerMarkerPath, "utf8") !== ownerToken) {
            return new GitWorktreeError(
              "WORKTREE_CLEANUP_FAILED",
              "The newly created Git worktree ownership marker changed"
            );
          }
        } catch (error) {
          return new GitWorktreeError(
            "WORKTREE_CLEANUP_FAILED",
            "Unable to verify ownership of the newly created Git worktree",
            error
          );
        }
        const removed = await runGit(
          runner,
          ["worktree", "remove", "--force", registered.record.cwd],
          repoRoot
        );
        if (removed.code !== 0) {
          lastError = new GitWorktreeError(
            "WORKTREE_CLEANUP_FAILED",
            `Failed to remove Git worktree${conciseGitError(removed.stderr)}`
          );
          continue;
        }
        worktreeRemoved = true;
      }

      const listedAfterRemoval = await runGit(
        runner,
        ["worktree", "list", "--porcelain", "-z"],
        repoRoot
      );
      if (listedAfterRemoval.code !== 0) {
        lastError = new GitWorktreeError(
          "WORKTREE_CLEANUP_FAILED",
          `Unable to verify Git branch ownership${conciseGitError(listedAfterRemoval.stderr)}`
        );
        continue;
      }
      const remaining = findRegisteredWorktree(listedAfterRemoval.stdout, cwd);
      if (remaining.uncertain || remaining.record || existsSync(cwd)) {
        lastError = new GitWorktreeError(
          "WORKTREE_CLEANUP_FAILED",
          remaining.uncertain
            ? "Unable to verify whether the Git worktree was removed"
            : remaining.record
              ? "The Git worktree is still registered after cleanup"
              : "The Git worktree path still exists after cleanup"
        );
        continue;
      }
      if (hasRegisteredBranch(listedAfterRemoval.stdout, branchName)) {
        lastError = new GitWorktreeError(
          "WORKTREE_CLEANUP_FAILED",
          "The Git branch is still registered to a worktree"
        );
        continue;
      }
      // The branch intentionally remains after an unidentified cleanup. Its
      // ownership cannot be proved without the result captured after add.
      return undefined;
    } catch (error) {
      lastError = error;
    }
  }
  return lastError;
}

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

    const registeredBeforeCreate = await runGit(
      runner,
      ["worktree", "list", "--porcelain", "-z"],
      repoRoot
    );
    if (registeredBeforeCreate.code !== 0) {
      throw new GitWorktreeError(
        "WORKTREE_CREATE_FAILED",
        `Unable to inspect existing Git worktrees${conciseGitError(registeredBeforeCreate.stderr)}`
      );
    }
    const existingTarget = findRegisteredWorktree(
      registeredBeforeCreate.stdout,
      targetPath
    );
    if (existingTarget.record) {
      throw new GitWorktreeError(
        "TARGET_EXISTS",
        `Worktree directory already exists: ${targetPath}`
      );
    }
    if (existingTarget.uncertain) {
      throw new GitWorktreeError(
        "WORKTREE_CREATE_FAILED",
        `Unable to verify whether a Git worktree already uses ${targetPath}`
      );
    }

    const created = await runGit(
      runner,
      ["worktree", "add", "--no-checkout", "-b", branchName, targetPath, "HEAD"],
      repoRoot
    );
    if (created.code !== 0) {
      // A failed `worktree add -b` does not prove ownership: an external Git
      // process may have claimed the branch or target after preflight. Do not
      // force-remove either resource when creation did not succeed.
      throw new GitWorktreeError(
        "WORKTREE_CREATE_FAILED",
        `Failed to create Git worktree${conciseGitError(created.stderr)}`
      );
    }

    const ownerToken = randomUUID();
    let ownerMarkerPath: string | undefined;
    let createdHead: string | undefined;
    let worktree: GitWorktreeResult | undefined;
    try {
      const gitDir = await readWorktreeGitDir(runner, targetPath);
      ownerMarkerPath = join(gitDir, "pi-agent-desktop-worktree-owner");
      if (existsSync(gitDir)) {
        writeFileSync(ownerMarkerPath, ownerToken, { flag: "wx" });
      } else {
        ownerMarkerPath = undefined;
      }
      const head = await readWorktreeHead(runner, targetPath);
      createdHead = head;
      await recordBranchOwnership(runner, repoRoot, branchName, head, ownerToken);
      worktree = {
        cwd: targetPath,
        branchName,
        repoRoot,
        gitDir,
        head,
        branchOwnerToken: ownerToken,
        ...(ownerMarkerPath ? { ownerMarkerPath, ownerToken } : {}),
      };
      const checkoutIdentity = await readWorktreeIdentity(runner, targetPath);
      if (
        checkoutIdentity.head !== worktree.head ||
        pathsMatch(checkoutIdentity.gitDir, worktree.gitDir) !== true
      ) {
        throw new GitWorktreeError(
          "WORKTREE_CREATE_FAILED",
          "The Git worktree identity changed before checkout"
        );
      }
      const checkedOut = await runGit(
        runner,
        ["checkout", "--force", "HEAD"],
        targetPath
      );
      if (checkedOut.code !== 0) {
        throw new GitWorktreeError(
          "WORKTREE_CREATE_FAILED",
          `Failed to check out Git worktree${conciseGitError(checkedOut.stderr)}`
        );
      }
      const finalIdentity = await readWorktreeIdentity(runner, targetPath);
      if (
        finalIdentity.head !== worktree.head ||
        pathsMatch(finalIdentity.gitDir, worktree.gitDir) !== true
      ) {
        throw new GitWorktreeError(
          "WORKTREE_CREATE_FAILED",
          "The Git worktree identity changed after checkout"
        );
      }
      if (ownerMarkerPath && ownerToken) {
        try {
          if (readFileSync(ownerMarkerPath, "utf8") !== ownerToken) {
            throw new GitWorktreeError(
              "WORKTREE_CREATE_FAILED",
              "The Git worktree ownership marker changed after checkout"
            );
          }
        } catch (error) {
          if (error instanceof GitWorktreeError) throw error;
          throw new GitWorktreeError(
            "WORKTREE_CREATE_FAILED",
            "Unable to verify Git worktree ownership marker after checkout",
            error
          );
        }
      }
      return await operation(worktree);
    } catch (error) {
      if (worktree) {
        const cleanupTarget = { worktree, removeBranch: true };
        const cleanupError = await cleanupWorktreeWithRetry(cleanupTarget, runner);
        if (cleanupError) deps.onCleanupError?.(cleanupError, cleanupTarget);
      } else {
        const cleanupError = await cleanupUnidentifiedWorktree(
          runner,
          repoRoot,
          targetPath,
          branchName,
          ownerMarkerPath,
          ownerToken,
          createdHead
        );        if (cleanupError) {
          const cleanupMessage =
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
          throw new GitWorktreeError(
            "WORKTREE_CREATE_FAILED",
            `${error instanceof Error ? error.message : String(error)}; ${cleanupMessage}`,
            error
          );
        }
      }
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

type CleanupProgress = {
  worktreeRemoved: boolean;
};

async function cleanupWorktreeWithRetry(
  cleanupTarget: GitWorktreeCleanupTarget,
  runner: GitRunner
): Promise<unknown> {
  const progress: CleanupProgress = { worktreeRemoved: false };
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await removeGitWorktreeUnlocked(
        cleanupTarget.worktree,
        runner,
        {
          removeBranch: cleanupTarget.removeBranch,
          worktreeAlreadyRemoved: progress.worktreeRemoved,
        },
        progress
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
  options: { removeBranch?: boolean; worktreeAlreadyRemoved?: boolean } = {},
  progress: CleanupProgress = { worktreeRemoved: false }
): Promise<void> {
  const errors: unknown[] = [];
  let worktreeReadyForBranchDeletion = options.worktreeAlreadyRemoved === true;

  if (!options.worktreeAlreadyRemoved) {
    try {
      const listed = await runGit(
        runner,
        ["worktree", "list", "--porcelain", "-z"],
        worktree.repoRoot
      );
      if (listed.code !== 0) {
        errors.push(
          new GitWorktreeError(
            "WORKTREE_CLEANUP_FAILED",
            `Unable to inspect Git worktrees${conciseGitError(listed.stderr)}`
          )
        );
      } else {
        const registered = findRegisteredWorktree(listed.stdout, worktree.cwd);
        if (registered.uncertain) {
          errors.push(
            new GitWorktreeError(
              "WORKTREE_CLEANUP_FAILED",
              "Unable to verify whether the Git worktree still exists"
            )
          );
        } else if (registered.record) {
          if (
            registered.record.branchName !== worktree.branchName ||
            registered.record.head !== worktree.head
          ) {
            errors.push(
              new GitWorktreeError(
                "WORKTREE_CLEANUP_FAILED",
                "The registered Git worktree is not owned by this operation"
              )
            );
          } else {
            let markerMatches = true;
            if (worktree.ownerMarkerPath && worktree.ownerToken) {
              try {
                markerMatches =
                  readFileSync(worktree.ownerMarkerPath, "utf8") === worktree.ownerToken;
              } catch (error) {
                markerMatches = false;
                errors.push(
                  new GitWorktreeError(
                    "WORKTREE_CLEANUP_FAILED",
                    "Unable to verify Git worktree ownership marker",
                    error
                  )
                );
              }
              if (!markerMatches && errors.length === 0) {
                errors.push(
                  new GitWorktreeError(
                    "WORKTREE_CLEANUP_FAILED",
                    "The Git worktree ownership marker changed"
                  )
                );
              }
            }
            let identity: { gitDir: string; head: string } | undefined;
            if (markerMatches) {
              try {
                identity = await readWorktreeIdentity(runner, registered.record.cwd);
              } catch (error) {
                errors.push(
                  new GitWorktreeError(
                    "WORKTREE_CLEANUP_FAILED",
                    "Unable to verify Git worktree identity",
                    error
                  )
                );
              }
            }
            if (
              markerMatches &&
              identity &&
              identity.head === worktree.head &&
              pathsMatch(identity.gitDir, worktree.gitDir) === true
            ) {
              // Git only accepts a path here, not the linked worktree's admin
              // directory. The identity check above plus the post-remove
              // registration/path check below is the safest available guard.
              const removed = await runGit(
                runner,
                ["worktree", "remove", "--force", registered.record.cwd],
                worktree.repoRoot
              );
              if (removed.code !== 0) {
                errors.push(
                  new GitWorktreeError(
                    "WORKTREE_CLEANUP_FAILED",
                    `Failed to remove Git worktree${conciseGitError(removed.stderr)}`
                  )
                );
              } else {
                worktreeReadyForBranchDeletion = true;
                progress.worktreeRemoved = true;
              }
            } else if (identity) {
              errors.push(
                new GitWorktreeError(
                  "WORKTREE_CLEANUP_FAILED",
                  "The Git worktree identity changed before cleanup"
                )
              );
            }
          }
        } else if (options.removeBranch !== false) {
          errors.push(
            new GitWorktreeError(
              "WORKTREE_CLEANUP_FAILED",
              "The Git worktree registration is missing; branch ownership is unverified"
            )
          );
        }
      }
    } catch (error) {
      errors.push(error);
    }
  }

  if (
    options.removeBranch !== false &&
    worktreeReadyForBranchDeletion &&
    errors.length === 0
  ) {
    try {
      const listedAfterRemoval = await runGit(
        runner,
        ["worktree", "list", "--porcelain", "-z"],
        worktree.repoRoot
      );
      if (listedAfterRemoval.code !== 0) {
        errors.push(
          new GitWorktreeError(
            "WORKTREE_CLEANUP_FAILED",
            `Unable to verify Git branch ownership${conciseGitError(listedAfterRemoval.stderr)}`
          )
        );
      } else {
        const remaining = findRegisteredWorktree(listedAfterRemoval.stdout, worktree.cwd);
        if (remaining.uncertain || remaining.record || existsSync(worktree.cwd)) {
          errors.push(
            new GitWorktreeError(
              "WORKTREE_CLEANUP_FAILED",
              remaining.uncertain
                ? "Unable to verify whether the Git worktree was removed"
                : remaining.record
                  ? "The Git worktree is still registered after cleanup"
                  : "The Git worktree path still exists after cleanup"
            )
          );
        } else if (hasRegisteredBranch(listedAfterRemoval.stdout, worktree.branchName)) {
          errors.push(
            new GitWorktreeError(
              "WORKTREE_CLEANUP_FAILED",
              "The Git branch is still registered to a worktree"
            )
          );
        } else if (!worktree.branchOwnerToken) {
          errors.push(
            new GitWorktreeError(
              "WORKTREE_CLEANUP_FAILED",
              "The Git branch ownership marker is missing"
            )
          );
        } else {
          await assertBranchOwnership(
            runner,
            worktree.repoRoot,
            worktree.branchName,
            worktree.head,
            worktree.branchOwnerToken
          );
          const branch = await runGit(
            runner,
            [
              "update-ref",
              "--no-deref",
              "-d",
              `refs/heads/${worktree.branchName}`,
              worktree.head,
            ],
            worktree.repoRoot
          );
          if (branch.code !== 0) {
            const state = await runGit(
              runner,
              ["show-ref", "--verify", "--quiet", `refs/heads/${worktree.branchName}`],
              worktree.repoRoot
            );
            if (state.code !== 1) {
              errors.push(
                new GitWorktreeError(
                  "WORKTREE_CLEANUP_FAILED",
                  `Failed to remove Git worktree branch${conciseGitError(branch.stderr)}`
                )
              );
            }
          }
        }
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
    removeGitWorktreeUnlocked(worktree, runner, {
      ...options,
    })
  );
}
