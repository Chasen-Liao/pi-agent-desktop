import { NextResponse } from "next/server";
import { errorMessage, getRequestId, logApiError } from "@/lib/api-error";
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
      return NextResponse.json(
        { error: "JSON body is required" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    const parsed = parseForgetBody(body);
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

    const { cwd, memoryIds, observationIds } = parsed.value;
    const result = await service.forgetFromCwd(cwd, {
      ...(memoryIds !== undefined ? { memoryIds } : {}),
      ...(observationIds !== undefined ? { observationIds } : {}),
    });
    return NextResponse.json(result, { headers: { "x-request-id": requestId } });
  } catch (error) {
    if (isLtmDisabledError(error)) {
      return NextResponse.json(
        { error: LTM_DISABLED },
        { status: 503, headers: { "x-request-id": requestId } }
      );
    }
    logApiError({
      route: "/api/memory/forget",
      method: "POST",
      requestId,
      error,
    });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
