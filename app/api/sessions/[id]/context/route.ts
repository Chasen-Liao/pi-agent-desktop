import { NextResponse } from "next/server";
import { resolveSessionPath, buildSessionContext, getSessionEntriesAsync } from "@/lib/session-reader";
import { errorMessage, getRequestId, logApiError } from "@/lib/api-error";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = getRequestId(req);
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404, headers: { "x-request-id": requestId } });
    }

    const entries = await getSessionEntriesAsync(filePath);
    const context = buildSessionContext(entries, leafId);

    return NextResponse.json({ context });
  } catch (error) {
    logApiError({ route: "/api/sessions/[id]/context", method: "GET", requestId, error, params: { id, leafId } });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
