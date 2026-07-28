import { NextResponse } from "next/server.js";
import { errorMessage, getRequestId, logApiError } from "../../../lib/api-error.ts";
import { getMcpServers, removeMcpServer, saveMcpServer, type McpServerConfig } from "../../../lib/mcp-config.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const requestId = getRequestId(req);
  try {
    const { searchParams } = new URL(req.url);
    const cwd = searchParams.get("cwd") ?? undefined;
    const servers = getMcpServers(cwd);
    return NextResponse.json({ servers }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    logApiError({ route: "/api/mcp", method: "GET", requestId, error });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  try {
    const body = (await req.json()) as {
      scope?: "global" | "project";
      cwd?: string;
      server?: McpServerConfig;
    };
    const { scope, cwd, server } = body ?? {};
    if (!scope || (scope !== "global" && scope !== "project")) {
      return NextResponse.json(
        { error: "scope must be 'global' or 'project'" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }
    if (!server || typeof server !== "object" || !server.id || typeof server.id !== "string") {
      return NextResponse.json(
        { error: "server configuration with valid id is required" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    const saved = saveMcpServer(scope, server, cwd);
    return NextResponse.json(
      { success: true, server: saved },
      { headers: { "x-request-id": requestId } }
    );
  } catch (error) {
    logApiError({ route: "/api/mcp", method: "POST", requestId, error });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}

export async function DELETE(req: Request) {
  const requestId = getRequestId(req);
  try {
    const body = (await req.json()) as {
      id?: string;
      scope?: "global" | "project";
      cwd?: string;
    };
    const { id, scope, cwd } = body ?? {};
    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }
    if (!scope || (scope !== "global" && scope !== "project")) {
      return NextResponse.json(
        { error: "scope must be 'global' or 'project'" },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    const success = removeMcpServer(scope, id, cwd);
    if (!success) {
      return NextResponse.json(
        { success: false, error: "Server not found" },
        { status: 404, headers: { "x-request-id": requestId } }
      );
    }

    return NextResponse.json({ success: true }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    logApiError({ route: "/api/mcp", method: "DELETE", requestId, error });
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
