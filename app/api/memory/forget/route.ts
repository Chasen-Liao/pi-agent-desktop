import { NextResponse } from "next/server";
import { errorMessage, getRequestId, jsonError, logApiError } from "@/lib/api-error";
import { isLtmDisabledError, LTM_DISABLED, parseForgetBody } from "@/lib/ltm/http";
import { getMemoryService } from "@/lib/ltm/service";

export const dynamic = "force-dynamic";

/** POST /api/memory/forget — body: { cwd, memoryIds?, observationIds? } */
export async function POST(req: Request) {
  const requestId = getRequestId(req);
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError(req, 400, "JSON body is required");
    }

    const parsed = parseForgetBody(body);
    if (!parsed.ok) {
      return jsonError(req, 400, parsed.error);
    }

    const service = getMemoryService();
    if (!service.isEnabled()) {
      return jsonError(req, 503, LTM_DISABLED);
    }

    const { cwd, memoryIds, observationIds } = parsed.value;
    const result = await service.forgetFromCwd(cwd, {
      ...(memoryIds !== undefined ? { memoryIds } : {}),
      ...(observationIds !== undefined ? { observationIds } : {}),
    });
    return NextResponse.json(result, { headers: { "x-request-id": requestId } });
  } catch (error) {
    if (isLtmDisabledError(error)) {
      return jsonError(req, 503, LTM_DISABLED);
    }
    logApiError({
      route: "/api/memory/forget",
      method: "POST",
      requestId,
      error,
    });
    return jsonError(req, 500, errorMessage(error));
  }
}
