import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { startRpcSession } from "@/lib/rpc-manager";
import { errorMessage, getRequestId, logApiError } from "@/lib/api-error";
import { validateAgentCwd } from "@/lib/path-policy";

// POST /api/agent/new  body: { cwd: string; type: string; message: string; ... }
// Spawns a brand-new pi session and immediately sends the first command.
// Returns { sessionId, data } where sessionId is pi's real session id.
export async function POST(req: Request) {
  const requestId = getRequestId(req);
  try {
    const body = await req.json() as { cwd?: string; [key: string]: unknown };
    const { cwd, ...command } = body;

    if (!cwd || typeof cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400, headers: { "x-request-id": requestId } });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400, headers: { "x-request-id": requestId } });
    }

    // Reject dangerous cwd values (filesystem root, user home, system dirs)
    // before granting the agent file access via the allowed-roots cache.
    // Without this, a single POST with cwd="C:\\" or "/" would let subsequent
    // /api/files requests read/write anywhere on disk.
    const cwdError = validateAgentCwd(cwd);
    if (cwdError) {
      return NextResponse.json({ error: cwdError }, { status: 400, headers: { "x-request-id": requestId } });
    }

    // Use a one-time key so startRpcSession's lock doesn't conflict with real session ids
    const { provider, modelId, toolNames, thinkingLevel, ...promptCommand } = command as { provider?: string; modelId?: string; toolNames?: string[]; thinkingLevel?: string; [key: string]: unknown };

    const tempKey = `__new__${Date.now()}__${Math.random().toString(36).slice(2, 8)}`;
    const { session, realSessionId } = await startRpcSession(tempKey, "", cwd, toolNames);

    // Keep the files-route allowed-roots cache (see app/api/files/[...path]/route.ts)
    // in sync so the new cwd is immediately readable via /api/files. Without this,
    // a file request under a brand-new cwd would 403 for up to the cache TTL.
    globalThis.__piAllowedRootsCache?.roots.add(cwd);

    // Apply pre-selected model before sending the prompt
    if (provider && modelId) {
      await session.send({ type: "set_model", provider, modelId });
    }

    // Apply pre-selected thinking level before sending the prompt
    if (thinkingLevel) {
      await session.send({ type: "set_thinking_level", level: thinkingLevel });
    }

    const result = await session.send(promptCommand);

    return NextResponse.json({ success: true, sessionId: realSessionId, data: result });
  } catch (error) {
    logApiError({ route: "/api/agent/new", method: "POST", requestId, error });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
