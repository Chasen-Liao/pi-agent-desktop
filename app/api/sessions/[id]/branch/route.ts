import { NextResponse } from "next/server.js";
import { existsSync } from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath, cacheSessionPath } from "../../../../../lib/session-reader.ts";
import { validateBranchPayload } from "../../../../../lib/session-branch-clone.ts";
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
        { error: "Session not found", errorCode: "SESSION_NOT_FOUND" },
        { status: 404, headers: { "x-request-id": requestId } }
      );
    }

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload", errorCode: "INVALID_JSON_PAYLOAD" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    const validation = validateBranchPayload(body);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: validation.error,
          ...(validation.code ? { errorCode: validation.code } : {}),
        },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    const sm = SessionManager.open(sessionFile);
    const entry = sm.getEntry(validation.data.targetEntryId);
    if (!entry) {
      return NextResponse.json(
        { error: "Target entry not found", errorCode: "TARGET_ENTRY_NOT_FOUND" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    const newSessionFile = sm.createBranchedSession(validation.data.targetEntryId);
    if (!newSessionFile) {
      return NextResponse.json(
        { error: "Failed to create branched session", errorCode: "BRANCH_CREATE_FAILED" },
        { status: 500, headers: { "x-request-id": requestId } }
      );
    }

    if (validation.data.name) {
      sm.appendSessionInfo(validation.data.name);
    }
    (sm as unknown as { _rewriteFile?: () => void })._rewriteFile?.();

    const newSessionId = sm.getSessionId();
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
    logApiError({ route: `/api/sessions/${id}/branch`, method: "POST", requestId, error });
    return NextResponse.json(
      { error: errorMessage(error), errorCode: "BRANCH_OPERATION_FAILED" },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
