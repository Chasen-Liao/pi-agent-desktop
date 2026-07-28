import { NextResponse } from "next/server.js";
import { errorMessage, getRequestId, logApiError } from "../../../../lib/api-error.ts";
import { toggleMcpServer } from "../../../../lib/mcp-config.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  try {
    const body = (await req.json()) as {
      id?: string;
      scope?: "global" | "project";
      disabled?: boolean;
      cwd?: string;
    };
    const { id, scope, disabled, cwd } = body ?? {};
    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }
    if (!scope || (scope !== "global" && scope !== "project")) {
      return NextResponse.json(
        { error: "scope must be 'global' or 'project'" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }
    if (typeof disabled !== "boolean") {
      return NextResponse.json(
        { error: "disabled must be a boolean" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    const success = toggleMcpServer(scope, id, disabled, cwd);
    if (!success) {
      return NextResponse.json(
        { success: false, error: "Server not found" },
        { status: 404, headers: { "x-request-id": requestId } }
      );
    }

    return NextResponse.json({ success: true }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    logApiError({ route: "/api/mcp/toggle", method: "POST", requestId, error });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
