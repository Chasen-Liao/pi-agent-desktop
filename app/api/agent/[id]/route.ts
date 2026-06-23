import { NextResponse } from "next/server";
import { resolveSessionPath, getHeaderAsync } from "@/lib/session-reader";
import { startRpcSession, getRpcSession } from "@/lib/rpc-manager";
import { errorMessage, getRequestId, logApiError } from "@/lib/api-error";
import { validateAgentCommand } from "@/lib/agent-commands";

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = getRequestId(req);

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };

    // Defense in depth: reject unknown/malformed command types at the route
    // boundary (400) rather than letting them fall through to pi's internal
    // throw (500, which could leak details via errorMessage).
    const cmdError = validateAgentCommand(body);
    if (cmdError) {
      return NextResponse.json(
        { error: cmdError },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    // Fast path: already-running session
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      const result = await existing.send(body);
      return NextResponse.json({ success: true, data: result });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404, headers: { "x-request-id": requestId } });
    }

    const header = await getHeaderAsync(filePath);
    const cwd = header?.cwd ?? process.cwd();

    const { session } = await startRpcSession(id, filePath, cwd);
    const result = await session.send(body);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    logApiError({ route: "/api/agent/[id]", method: "POST", requestId, error, params: { id } });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = getRequestId(_req);

  try {
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }

    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    logApiError({ route: "/api/agent/[id]", method: "GET", requestId, error, params: { id } });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
