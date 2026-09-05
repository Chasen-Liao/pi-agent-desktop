import { NextResponse } from "next/server.js";
import { errorMessage, getRequestId, jsonError, logApiError } from "../../../../lib/api-error.ts";
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
      return jsonError(req, 400, "id is required");
    }
    if (!scope || (scope !== "global" && scope !== "project")) {
      return jsonError(req, 400, "scope must be 'global' or 'project'");
    }
    if (typeof disabled !== "boolean") {
      return jsonError(req, 400, "disabled must be a boolean");
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
    return jsonError(req, 500, errorMessage(error));
  }
}
