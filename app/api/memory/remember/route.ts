import { NextResponse } from "next/server";
import { errorMessage, getRequestId, jsonError, logApiError } from "@/lib/api-error";
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
      return jsonError(req, 400, "JSON body is required");
    }

    const parsed = parseRememberBody(body);
    if (!parsed.ok) {
      return jsonError(req, 400, parsed.error);
    }

    const service = getMemoryService();
    if (!service.isEnabled()) {
      return jsonError(req, 503, LTM_DISABLED);
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
      return jsonError(req, 503, LTM_DISABLED);
    }
    logApiError({
      route: "/api/memory/remember",
      method: "POST",
      requestId,
      error,
    });
    return jsonError(req, 500, errorMessage(error));
  }
}
