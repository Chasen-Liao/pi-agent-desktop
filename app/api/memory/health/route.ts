import { NextResponse } from "next/server";
import { getRequestId } from "@/lib/api-error";
import { jsonLtmError } from "@/lib/ltm/http";
import { getMemoryService } from "@/lib/ltm/service";

export const dynamic = "force-dynamic";

/** GET /api/memory/health */
export async function GET(req: Request) {
  const requestId = getRequestId(req);
  try {
    const service = getMemoryService();
    const health = await service.health();
    return NextResponse.json(
      {
        ...health,
        enabled: service.isEnabled(),
      },
      { headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    return jsonLtmError(req, error, {
      route: "/api/memory/health",
      method: "GET",
      requestId,
    });
  }
}
