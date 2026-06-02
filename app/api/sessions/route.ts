import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { errorMessage, getRequestId, logApiError } from "@/lib/api-error";

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  try {
    const sessions = await listAllSessions();
    return NextResponse.json({ sessions });
  } catch (error) {
    logApiError({ route: "/api/sessions", method: "GET", requestId, error });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
