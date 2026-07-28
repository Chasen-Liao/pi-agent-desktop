import { NextResponse } from "next/server.js";
import { existsSync } from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath, cacheSessionPath } from "../../../../../lib/session-reader.ts";
import { validateClonePayload } from "../../../../../lib/session-branch-clone.ts";
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
    const targetCwd = validation.data.targetCwd || header?.cwd || process.cwd();

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
      },
      { headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    logApiError({ route: `/api/sessions/${id}/clone`, method: "POST", requestId, error });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
