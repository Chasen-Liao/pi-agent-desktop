import { NextResponse } from "next/server";
import { errorMessage, getRequestId, logApiError } from "@/lib/api-error";
import { isLtmDisabledError, LTM_DISABLED, parseRecallQuery } from "@/lib/ltm/http";
import { getMemoryService } from "@/lib/ltm/service";

export const dynamic = "force-dynamic";

/** GET /api/memory/recall?cwd=&q=&limit? */
export async function GET(req: Request) {
  const requestId = getRequestId(req);
  try {
    const parsed = parseRecallQuery(new URL(req.url));
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    const service = getMemoryService();
    if (!service.isEnabled()) {
      return NextResponse.json(
        { error: LTM_DISABLED },
        { status: 503, headers: { "x-request-id": requestId } }
      );
    }

    const { cwd, query, limit } = parsed.value;
    const hits = await service.recallFromCwd(cwd, {
      query,
      ...(limit !== undefined ? { limit } : {}),
    });
    return NextResponse.json(
      { hits },
      { headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    if (isLtmDisabledError(error)) {
      return NextResponse.json(
        { error: LTM_DISABLED },
        { status: 503, headers: { "x-request-id": requestId } }
      );
    }
    logApiError({ route: "/api/memory/recall", method: "GET", requestId, error });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
