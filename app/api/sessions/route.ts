import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { errorMessage, getRequestId, jsonError, logApiError } from "@/lib/api-error";

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  try {
    const sessions = await listAllSessions();
    return NextResponse.json({ sessions });
  } catch (error) {
    logApiError({ route: "/api/sessions", method: "GET", requestId, error });
    return jsonError(req, 500, errorMessage(error));
  }
}
