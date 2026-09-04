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
  GitWorktreeError,
  withGitWorktree,
} from "../../../../../lib/git-worktree.ts";
import { errorMessage, getRequestId, logApiError } from "../../../../../lib/api-error.ts";

export const dynamic = "force-dynamic";

type CloneWorkspace = {
  mode: "directory" | "worktree";
  cwd: string;
  branchName?: string;
};

class CloneCreateError extends Error {
  readonly code = "CLONE_CREATE_FAILED" as const;

  constructor() {
    super("Failed to clone session");
    this.name = "CloneCreateError";
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: unknown }).code === code
  );
}

function removeForkedSessionFiles(
  sessionsRoot: string,
  sessionId: string,
  knownSessionFile?: string
): void {
  const sessionFiles = new Set<string>();
  const errors: unknown[] = [];
  if (knownSessionFile) sessionFiles.add(knownSessionFile);

  try {
    for (const fileName of readdirSync(sessionsRoot, { recursive: true })) {
      const relativePath = typeof fileName === "string" ? fileName : fileName.toString();
      if (relativePath.endsWith(`_${sessionId}.jsonl`)) {
        sessionFiles.add(join(sessionsRoot, relativePath));
      }
    }
  } catch (error) {
    if (!isErrorCode(error, "ENOENT")) errors.push(error);
  }

  for (const sessionFile of sessionFiles) {
    try {
      rmSync(sessionFile, { force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new Error(
      errors.map((error) => (error instanceof Error ? error.message : String(error))).join("; ")
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = getRequestId(req);
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

    const targetCwd = validation.data.targetCwd || sourceCwd;
    const directoryWorkspace: CloneWorkspace = {
      mode: "directory",
      cwd: targetCwd,
    };
    const cloneSession = (cloneCwd: string, workspace: CloneWorkspace) => {
      cloneSessionsRoot = getSessionsDir();
      cloneSessionId = randomUUID();
      const forkedSm = SessionManager.forkFrom(
        sessionFile,
        cloneCwd,
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
    };

    if (validation.data.workspaceMode === "worktree") {
      return await withGitWorktree(
        {
          sourceCwd,
          targetCwd: validation.data.targetCwd,
          branchName: validation.data.branchName,
        },
        (worktree) =>
          cloneSession(worktree.cwd, {
            mode: "worktree",
            cwd: worktree.cwd,
            branchName: worktree.branchName,
          }),
        {
          onCleanupError: (cleanupError, target) =>
            logApiError({
              route: `/api/sessions/${id}/clone`,
              method: "POST",
              requestId,
              error: cleanupError,
              params: { worktreeCwd: target.worktree.cwd },
            }),
        }
      );
    }

    return cloneSession(targetCwd, directoryWorkspace);
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
