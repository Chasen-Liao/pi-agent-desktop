import { NextResponse } from "next/server";
import { errorMessage, getRequestId, jsonError, logApiError } from "@/lib/api-error";
import {
  isLtmDisabledError,
  isStatsNotSupportedError,
  LTM_DISABLED,
  LTM_STATS_NOT_SUPPORTED,
  parseStatsQuery,
} from "@/lib/ltm/http";
import { getMemoryService } from "@/lib/ltm/service";

export const dynamic = "force-dynamic";

/** GET /api/memory/stats?cwd= */
export async function GET(req: Request) {
  const requestId = getRequestId(req);
  try {
    const parsed = parseStatsQuery(new URL(req.url));
    if (!parsed.ok) return jsonError(req, 400, parsed.error);

    const service = getMemoryService();
    if (!service.isEnabled()) return jsonError(req, 503, LTM_DISABLED);

    const stats = await service.statsFromCwd(parsed.value.cwd);
    return NextResponse.json(stats, { headers: { "x-request-id": requestId } });
  } catch (error) {
    if (isLtmDisabledError(error)) return jsonError(req, 503, LTM_DISABLED);
    if (isStatsNotSupportedError(error)) return jsonError(req, 501, LTM_STATS_NOT_SUPPORTED);
    logApiError({ route: "/api/memory/stats", method: "GET", requestId, error });
    return jsonError(req, 500, errorMessage(error));
  }
}
