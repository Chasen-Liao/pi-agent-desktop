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
  try {
    const parsed = parseStatsQuery(new URL(req.url));
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

    const stats = await service.statsFromCwd(parsed.value.cwd);
    return NextResponse.json(stats, { headers: { "x-request-id": requestId } });
  } catch (error) {
    if (isLtmDisabledError(error)) {
      return NextResponse.json(
        { error: LTM_DISABLED },
        { status: 503, headers: { "x-request-id": requestId } }
      );
    }
    if (isStatsNotSupportedError(error)) {
      return NextResponse.json(
        { error: LTM_STATS_NOT_SUPPORTED },
        { status: 501, headers: { "x-request-id": requestId } }
      );
    }
    logApiError({ route: "/api/memory/stats", method: "GET", requestId, error });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
