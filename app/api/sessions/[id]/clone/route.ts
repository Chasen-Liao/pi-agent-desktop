import { NextResponse } from "next/server.js";
import { existsSync } from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath, cacheSessionPath } from "../../../../../lib/session-reader.ts";
import { validateClonePayload } from "../../../../../lib/session-branch-clone.ts";
import {
  createGitWorktree,
  GitWorktreeError,
} from "../../../../../lib/git-worktree.ts";
import { errorMessage, getRequestId, logApiError } from "../../../../../lib/api-error.ts";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = getRequestId(req);
  try {
    const sessionFile = await resolveSessionPath(id);
    if (!sessionFile || !existsSync(sessionFile)) {
      return NextResponse.json(
        { error: "Session not found" },
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
        { error: "Invalid JSON payload" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    const validation = validateClonePayload(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
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
      const worktree = await createGitWorktree({
        sourceCwd,
        targetCwd: validation.data.targetCwd,
        branchName: validation.data.branchName,
      });
      targetCwd = worktree.cwd;
      workspace = {
        mode: "worktree",
        cwd: worktree.cwd,
        branchName: worktree.branchName,
      };
    }

    const forkedSm = SessionManager.forkFrom(sessionFile, targetCwd);
    const newSessionFile = forkedSm.getSessionFile();
    if (!newSessionFile) {
      return NextResponse.json(
        { error: "Failed to clone session" },
        { status: 500, headers: { "x-request-id": requestId } }
      );
    }

    if (validation.data.name) {
      forkedSm.appendSessionInfo(validation.data.name);
    }
    (forkedSm as unknown as { _rewriteFile?: () => void })._rewriteFile?.();

    const newSessionId = forkedSm.getSessionId();
    cacheSessionPath(newSessionId, newSessionFile);

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
    logApiError({ route: `/api/sessions/${id}/clone`, method: "POST", requestId, error });
    const status =
      error instanceof GitWorktreeError && error.code !== "GIT_UNAVAILABLE" ? 400 : 500;
    return NextResponse.json(
      { error: errorMessage(error) },
      { status, headers: { "x-request-id": requestId } }
    );
  }
}
