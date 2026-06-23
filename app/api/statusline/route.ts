import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { isPathAllowedAsync } from "@/lib/allowed-roots";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 4000;

export interface StatuslineResponse {
  cwd: string;
  isRepo: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  modified: number;
  staged: number;
  untracked: number;
  deleted: number;
  lastCommit?: { hash: string; subject: string };
  error?: string;
}

// Count files by porcelain XY code. `git status --porcelain` lines look like:
//   " M path"   working tree change (not staged)
//   "M  path"   index change (staged)
//   "MM path"   staged + further WT change
//   "?? path"   untracked
//   "!! path"   ignored
//   "UU path"   unmerged
function summarizePorcelain(output: string): {
  modified: number;
  staged: number;
  untracked: number;
  deleted: number;
} {
  let modified = 0;
  let staged = 0;
  let untracked = 0;
  let deleted = 0;
  for (const raw of output.split("\n")) {
    if (!raw || raw.length < 3) continue;
    const x = raw[0];
    const y = raw[1];
    if (x === "?") {
      untracked++;
      continue;
    }
    if (x !== " " && x !== "?") staged++;
    if (y === "M") modified++;
    else if (y === "D") deleted++;
  }
  return { modified, staged, untracked, deleted };
}

async function readGit(cwd: string): Promise<Omit<StatuslineResponse, "cwd">> {
  // Throws if cwd is not inside a git working tree.
  await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: GIT_TIMEOUT_MS });

  const out: Omit<StatuslineResponse, "cwd"> = {
    isRepo: true,
    modified: 0,
    staged: 0,
    untracked: 0,
    deleted: 0,
  };

  // Branch — empty string means detached HEAD.
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd, timeout: GIT_TIMEOUT_MS },
    );
    const branch = stdout.trim();
    if (branch && branch !== "HEAD") out.branch = branch;
  } catch {
    // ignore — detached HEAD or transient error
  }

  // Ahead/behind upstream. Errors when no upstream is configured; treat as 0/0.
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-list", "--left-right", "--count", "HEAD...@{u}"],
      { cwd, timeout: GIT_TIMEOUT_MS },
    );
    const [a, b] = stdout.trim().split(/\s+/).map((n) => Number.parseInt(n, 10));
    if (Number.isFinite(a)) out.ahead = a;
    if (Number.isFinite(b)) out.behind = b;
  } catch {
    // no upstream tracking branch
  }

  // Porcelain status.
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain", "--untracked-files=normal"],
      { cwd, timeout: GIT_TIMEOUT_MS },
    );
    Object.assign(out, summarizePorcelain(stdout));
  } catch {
    // ignore — keep zeros
  }

  // Last commit (short hash + subject). May fail on a brand-new repo with no commits.
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "-1", "--format=%h%x00%s"],
      { cwd, timeout: GIT_TIMEOUT_MS },
    );
    const trimmed = stdout.replace(/\r?\n$/, "");
    if (trimmed) {
      const sepIdx = trimmed.indexOf("\0");
      const hash = sepIdx >= 0 ? trimmed.slice(0, sepIdx) : trimmed.split(" ")[0];
      const subject = sepIdx >= 0 ? trimmed.slice(sepIdx + 1) : trimmed.slice(hash.length + 1);
      if (hash) out.lastCommit = { hash, subject: subject.trim() };
    }
  } catch {
    // no commits yet
  }

  return out;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) {
    return NextResponse.json({ error: "cwd required" }, { status: 400 });
  }

  const cwdAllowed = await isPathAllowedAsync(cwd);
  if (!cwdAllowed) {
    return NextResponse.json({ error: "cwd not in allowed roots" }, { status: 403 });
  }

  try {
    const data = await readGit(cwd);
    return NextResponse.json({ cwd, ...data } satisfies StatuslineResponse);
  } catch (e) {
    // Not a git repo, or git is not installed, or cwd doesn't exist.
    // Surface as isRepo:false so the UI can show a graceful placeholder.
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      cwd,
      isRepo: false,
      modified: 0,
      staged: 0,
      untracked: 0,
      deleted: 0,
      error: message,
    } satisfies StatuslineResponse);
  }
}
