import { NextResponse } from "next/server";
import { errorMessage, getRequestId, jsonError, logApiError } from "@/lib/api-error";
import {
  applyTrustDecision,
  evaluateProjectTrust,
  isTrustOptionId,
  type TrustOptionId,
} from "@/lib/project-trust-desktop";
import { getSessionOnlyTrustMap } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

/** POST /api/trust  body: { cwd, optionId } */
export async function POST(req: Request) {
  const requestId = getRequestId(req);
  try {
    const body = (await req.json()) as { cwd?: string; optionId?: string };
    if (!body.cwd || typeof body.cwd !== "string") {
      return jsonError(req, 400, "cwd is required");
    }
    if (!isTrustOptionId(body.optionId)) {
      return jsonError(req, 400, "optionId must be trust | trust-parent | trust-session | deny | deny-session");
    }
    const sessionOnly = getSessionOnlyTrustMap();
    const result = applyTrustDecision(body.cwd, body.optionId as TrustOptionId, {
      sessionOnlyTrust: sessionOnly,
    });
    return NextResponse.json(
      { success: true, trusted: result.trusted, persisted: result.persisted },
      { headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    logApiError({ route: "/api/trust", method: "POST", requestId, error });
    return jsonError(req, 500, errorMessage(error));
  }
}

/** GET /api/trust?cwd= — status for UI / debugging */
export async function GET(req: Request) {
  const requestId = getRequestId(req);
  try {
    const url = new URL(req.url);
    const cwd = url.searchParams.get("cwd");
    if (!cwd) {
      return jsonError(req, 400, "cwd is required");
    }
    const gate = evaluateProjectTrust(cwd, { sessionOnlyTrust: getSessionOnlyTrustMap() });
    return NextResponse.json(gate, { headers: { "x-request-id": requestId } });
  } catch (error) {
    logApiError({ route: "/api/trust", method: "GET", requestId, error });
    return jsonError(req, 500, errorMessage(error));
  }
}
