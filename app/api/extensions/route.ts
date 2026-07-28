import { NextResponse } from "next/server.js";
import { errorMessage, getRequestId, logApiError } from "../../../lib/api-error.ts";
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
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  try {
    const body = (await req.json()) as MutateExtensionOptions;
    const { action, type, nameOrPath, scope } = body ?? {};

    if (!action || !["toggle", "add", "remove"].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'toggle', 'add', or 'remove'" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }
    if (!type || !["extension", "skill"].includes(type)) {
      return NextResponse.json(
        { error: "type must be 'extension' or 'skill'" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }
    if (!nameOrPath || typeof nameOrPath !== "string") {
      return NextResponse.json(
        { error: "nameOrPath is required" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }
    if (!scope || !["global", "project"].includes(scope)) {
      return NextResponse.json(
        { error: "scope must be 'global' or 'project'" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    const res = await mutateExtensionOrSkill(body);
    return NextResponse.json(res, { headers: { "x-request-id": requestId } });
  } catch (error) {
    logApiError({ route: "/api/extensions", method: "POST", requestId, error });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
