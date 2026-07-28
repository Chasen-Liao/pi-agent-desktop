import { NextResponse } from "next/server.js";
import { errorMessage, getRequestId, logApiError } from "../../../../lib/api-error.ts";
import { validateRequestOrigin } from "../../../../lib/auth-policy.ts";
import { testMcpServerConnection, type TestMcpServerOptions } from "../../../../lib/mcp-config.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const originError = validateRequestOrigin(req);
  if (originError) {
    return NextResponse.json(
      { error: originError },
      { status: 403, headers: { "x-request-id": requestId } }
    );
  }
  try {
    const body = (await req.json()) as TestMcpServerOptions;
    const result = await testMcpServerConnection(body ?? {});
    return NextResponse.json(
      {
        success: result.success,
        message: result.message,
        toolsCount: result.toolsCount,
      },
      { headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    logApiError({ route: "/api/mcp/test", method: "POST", requestId, error });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
