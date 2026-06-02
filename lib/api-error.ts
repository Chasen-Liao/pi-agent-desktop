import { randomUUID } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const incoming = req.headers.get("x-request-id");
  if (incoming && UUID_RE.test(incoming.trim())) {
    return incoming.trim();
  }
  return randomUUID();
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
