import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_IDS = new WeakMap<Request, string>();

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err === null || err === undefined) return String(err);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function getRequestId(req: Request): string {
  const existing = REQUEST_IDS.get(req);
  if (existing) return existing;

  const incoming = req.headers.get("x-request-id");
  const requestId = incoming && UUID_RE.test(incoming.trim())
    ? incoming.trim()
    : randomUUID();
  REQUEST_IDS.set(req, requestId);
  return requestId;
}

export type JsonErrorInit = Omit<ResponseInit, "status" | "headers"> & {
  headers?: HeadersInit;
};

export function jsonError(
  req: Request,
  status: number,
  message: unknown,
  extra: JsonErrorInit = {},
): NextResponse {
  const headers = new Headers(extra.headers);
  if (!headers.has("x-request-id")) {
    headers.set("x-request-id", getRequestId(req));
  }
  return NextResponse.json(
    { error: message },
    { ...extra, status, headers },
  );
}

export interface LogApiErrorInput {
  route: string;
  method: string;
  requestId: string;
  error: unknown;
  params?: Record<string, unknown>;
  status?: number;
}

export function logApiError(input: LogApiErrorInput): void {
  const { route, method, requestId, error, params, status } = input;
  const entry = {
    level: "error",
    scope: "api",
    route,
    method,
    requestId,
    status,
    message: errorMessage(error),
    stack: error instanceof Error ? error.stack : undefined,
    params,
  };
  console.error(JSON.stringify(entry));
}
