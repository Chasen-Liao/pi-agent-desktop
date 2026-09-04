import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server.js";
import { existsSync, readdirSync, rmSync } from "fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  getSessionsDir,
  resolveSessionPath,
  cacheSessionPath,
  invalidateSessionPathCache,
} from "../../../../../lib/session-reader.ts";
import { validateClonePayload } from "../../../../../lib/session-branch-clone.ts";
import {
  createGitWorktree,
  GitWorktreeError,
  removeGitWorktree,
  type GitWorktreeResult,
} from "../../../../../lib/git-worktree.ts";
import { errorMessage, getRequestId, logApiError } from "../../../../../lib/api-error.ts";

export const dynamic = "force-dynamic";

class CloneCreateError extends Error {
  readonly code = "CLONE_CREATE_FAILED" as const;

  constructor() {
    super("Failed to clone session");
    this.name = "CloneCreateError";
  }
}

function removeForkedSessionFiles(
  sessionsRoot: string,
  sessionId: string,
  knownSessionFile?: string
): void {
  const sessionFiles = new Set<string>();
  if (knownSessionFile) sessionFiles.add(knownSessionFile);

  try {
    for (const fileName of readdirSync(sessionsRoot, { recursive: true })) {
      const relativePath = typeof fileName === "string" ? fileName : fileName.toString();
      if (relativePath.endsWith(`_${sessionId}.jsonl`)) {
        sessionFiles.add(join(sessionsRoot, relativePath));
      }
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  for (const sessionFile of sessionFiles) {
    rmSync(sessionFile, { force: true });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = getRequestId(req);
  let createdWorktree: GitWorktreeResult | undefined;
  let cloneSessionsRoot: string | undefined;
  let cloneSessionId: string | undefined;
  let createdSessionFile: string | undefined;
  let cachedSessionId: string | undefined;
  try {
    const sessionFile = await resolveSessionPath(id);
    if (!sessionFile || !existsSync(sessionFile)) {
      return NextResponse.json(
        { error: "Session not found", errorCode: "SESSION_NOT_FOUND" },
        { status: 404, headers: { "x-request-id": requestId } }
      );
    }

    let body: unknown = {};
    try {
      const text = await req.text();
      if (text.trim().length > 0) {
        body = JSON.parse(text);
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload", errorCode: "INVALID_JSON_PAYLOAD" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    const validation = validateClonePayload(body);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: validation.error,
          ...(validation.code ? { errorCode: validation.code } : {}),
        },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    const sourceSm = SessionManager.open(sessionFile);
    const header = sourceSm.getHeader();
    const sourceCwd = header?.cwd || process.cwd();

    let targetCwd = validation.data.targetCwd || sourceCwd;
    let workspace: {
      mode: "directory" | "worktree";
      cwd: string;
      branchName?: string;
    } = {
      mode: "directory",
      cwd: targetCwd,
    };

    if (validation.data.workspaceMode === "worktree") {
      createdWorktree = await createGitWorktree({
        sourceCwd,
        targetCwd: validation.data.targetCwd,
        branchName: validation.data.branchName,
      });
      targetCwd = createdWorktree.cwd;
      workspace = {
        mode: "worktree",
        cwd: createdWorktree.cwd,
        branchName: createdWorktree.branchName,
      };
    }

    cloneSessionsRoot = getSessionsDir();
    cloneSessionId = randomUUID();
    const forkedSm = SessionManager.forkFrom(
      sessionFile,
      targetCwd,
      undefined,
      { id: cloneSessionId }
    );
    const newSessionFile = forkedSm.getSessionFile();
    if (!newSessionFile) {
      throw new CloneCreateError();
    }
    createdSessionFile = newSessionFile;

    if (validation.data.name) {
      forkedSm.appendSessionInfo(validation.data.name);
    }
    (forkedSm as unknown as { _rewriteFile?: () => void })._rewriteFile?.();

    const newSessionId = forkedSm.getSessionId();
    cacheSessionPath(newSessionId, newSessionFile);
    cachedSessionId = newSessionId;

    return NextResponse.json(
      {
        success: true,
        sessionId: newSessionId,
        sessionFile: newSessionFile,
        workspace,
      },
      { headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    if (cachedSessionId) {
      invalidateSessionPathCache(cachedSessionId);
    }
    if (cloneSessionsRoot && cloneSessionId) {
      try {
        removeForkedSessionFiles(cloneSessionsRoot, cloneSessionId, createdSessionFile);
      } catch (cleanupError) {
        logApiError({
          route: `/api/sessions/${id}/clone`,
          method: "POST",
          requestId,
          error: cleanupError,
          params: { sessionsRoot: cloneSessionsRoot, sessionId: cloneSessionId },
        });
      }
    }
    if (createdWorktree) {
      try {
        await removeGitWorktree(createdWorktree);
      } catch (cleanupError) {
        logApiError({
          route: `/api/sessions/${id}/clone`,
          method: "POST",
          requestId,
          error: cleanupError,
          params: { worktreeCwd: createdWorktree.cwd },
        });
      }
    }
    logApiError({ route: `/api/sessions/${id}/clone`, method: "POST", requestId, error });
    const status =
      error instanceof GitWorktreeError && error.code !== "GIT_UNAVAILABLE" ? 400 : 500;
    return NextResponse.json(
      {
        error: errorMessage(error),
        errorCode:
          error instanceof GitWorktreeError
            ? error.code
            : error instanceof CloneCreateError
              ? error.code
              : "CLONE_OPERATION_FAILED",
      },
      { status, headers: { "x-request-id": requestId } }
    );
  }
}
