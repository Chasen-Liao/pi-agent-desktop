import { NextResponse } from "next/server.js";
import { errorMessage, getRequestId, jsonError, logApiError } from "../../../lib/api-error.ts";
import { getExtensionsConfig, mutateExtensionOrSkill, type MutateExtensionOptions } from "../../../lib/extensions-config.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  try {
    const { searchParams } = new URL(req.url);
    const cwd = searchParams.get("cwd") ?? undefined;
    const result = await getExtensionsConfig(cwd);
    return NextResponse.json(result, { headers: { "x-request-id": requestId } });
  } catch (error) {
    logApiError({ route: "/api/extensions", method: "GET", requestId, error });
    return jsonError(req, 500, errorMessage(error));
  }
}

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  try {
    const body = (await req.json()) as MutateExtensionOptions;
    const { action, type, nameOrPath, scope } = body ?? {};

    if (!action || !["toggle", "add", "remove"].includes(action)) {
      return jsonError(req, 400, "action must be 'toggle', 'add', or 'remove'");
    }
    if (!type || !["extension", "skill"].includes(type)) {
      return jsonError(req, 400, "type must be 'extension' or 'skill'");
    }
    if (!nameOrPath || typeof nameOrPath !== "string") {
      return jsonError(req, 400, "nameOrPath is required");
    }
    if (!scope || !["global", "project"].includes(scope)) {
      return jsonError(req, 400, "scope must be 'global' or 'project'");
    }

    const res = await mutateExtensionOrSkill(body);
    return NextResponse.json(res, { headers: { "x-request-id": requestId } });
  } catch (error) {
    logApiError({ route: "/api/extensions", method: "POST", requestId, error });
    return jsonError(req, 500, errorMessage(error));
  }
}
