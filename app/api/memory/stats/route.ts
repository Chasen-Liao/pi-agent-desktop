import { NextResponse } from "next/server";
import { errorMessage, getRequestId, logApiError } from "@/lib/api-error";
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
  const jsonError = (message: string, status: number) =>
    NextResponse.json({ error: message }, { status, headers: { "x-request-id": requestId } });
  try {
    const parsed = parseStatsQuery(new URL(req.url));
    if (!parsed.ok) return jsonError(parsed.error, 400);

    const service = getMemoryService();
    if (!service.isEnabled()) return jsonError(LTM_DISABLED, 503);

    const stats = await service.statsFromCwd(parsed.value.cwd);
    return NextResponse.json(stats, { headers: { "x-request-id": requestId } });
  } catch (error) {
    if (isLtmDisabledError(error)) return jsonError(LTM_DISABLED, 503);
    if (isStatsNotSupportedError(error)) return jsonError(LTM_STATS_NOT_SUPPORTED, 501);
    logApiError({ route: "/api/memory/stats", method: "GET", requestId, error });
    return jsonError(errorMessage(error), 500);
  }
}
