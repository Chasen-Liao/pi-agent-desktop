import { NextResponse } from "next/server";
import { getRequestId, jsonError } from "@/lib/api-error";
import { jsonLtmError, LTM_DISABLED, parseStatsQuery } from "@/lib/ltm/http";
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
    return jsonLtmError(
      req,
      error,
      { route: "/api/memory/stats", method: "GET", requestId },
      { statsNotSupported: true },
    );
  }
}
