import { NextResponse } from "next/server";
import { errorMessage, getRequestId, logApiError } from "@/lib/api-error";
import { isLtmDisabledError, LTM_DISABLED, parseRememberBody } from "@/lib/ltm/http";
import { getMemoryService } from "@/lib/ltm/service";

export const dynamic = "force-dynamic";

/** POST /api/memory/remember — body: { cwd, content, type?, concepts?, files? } */
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

    const parsed = parseRememberBody(body);
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

    const { cwd, content, type, concepts, files } = parsed.value;
    const result = await service.rememberFromCwd(cwd, {
      content,
      ...(type !== undefined ? { type } : {}),
      ...(concepts !== undefined ? { concepts } : {}),
      ...(files !== undefined ? { files } : {}),
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
      route: "/api/memory/remember",
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
