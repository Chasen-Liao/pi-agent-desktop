import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  mergeDesktopSettings,
  readDesktopSettings,
  validateDesktopSettingsBody,
  writeDesktopSettings,
} from "@/lib/desktop-settings";
import { errorMessage, getRequestId, jsonError, logApiError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  try {
    const settings = readDesktopSettings(getAgentDir());
    return NextResponse.json(settings, { headers: { "x-request-id": requestId } });
  } catch (error) {
    logApiError({ route: "/api/desktop-settings", method: "GET", requestId, error });
    return jsonError(req, 500, errorMessage(error));
  }
}

export async function PUT(req: Request) {
  const requestId = getRequestId(req);
  try {
    const body: unknown = await req.json();
    const err = validateDesktopSettingsBody(body);
    if (err) {
      return jsonError(req, 400, err);
    }
    const agentDir = getAgentDir();
    const current = readDesktopSettings(agentDir);
    const merged = mergeDesktopSettings({ ...current, ...(body as object) });
    const saved = writeDesktopSettings(agentDir, merged);
    return NextResponse.json(saved, { headers: { "x-request-id": requestId } });
  } catch (error) {
    logApiError({ route: "/api/desktop-settings", method: "PUT", requestId, error });
    return jsonError(req, 500, errorMessage(error));
  }
}
