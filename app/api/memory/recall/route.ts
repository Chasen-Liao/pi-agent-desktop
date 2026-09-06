import { NextResponse } from "next/server";
import { errorMessage, getRequestId, jsonError, logApiError } from "@/lib/api-error";
import { isLtmDisabledError, LTM_DISABLED, parseRecallQuery } from "@/lib/ltm/http";
import { getMemoryService } from "@/lib/ltm/service";

export const dynamic = "force-dynamic";

/** GET /api/memory/recall?cwd=&q=&limit? */
export async function GET(req: Request) {
  const requestId = getRequestId(req);
  try {
    const parsed = parseRecallQuery(new URL(req.url));
    if (!parsed.ok) {
      return jsonError(req, 400, parsed.error);
    }

    const service = getMemoryService();
    if (!service.isEnabled()) {
      return jsonError(req, 503, LTM_DISABLED);
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
      return jsonError(req, 503, LTM_DISABLED);
    }
    logApiError({ route: "/api/memory/recall", method: "GET", requestId, error });
    return jsonError(req, 500, errorMessage(error));
  }
}
