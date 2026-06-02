import test from "node:test";
import assert from "node:assert/strict";
import { errorMessage, getRequestId, logApiError } from "./api-error.ts";

// ---------------------------------------------------------------------------
// errorMessage
// ---------------------------------------------------------------------------

test("errorMessage: Error instance returns err.message", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
});

test("errorMessage: string returns the string", () => {
  assert.equal(errorMessage("oops"), "oops");
});

test("errorMessage: number returns the number as string", () => {
  assert.equal(errorMessage(42), "42");
});

test("errorMessage: null returns 'null'", () => {
  assert.equal(errorMessage(null), "null");
});

test("errorMessage: undefined returns 'undefined'", () => {
  assert.equal(errorMessage(undefined), "undefined");
});

test("errorMessage: plain object returns JSON.stringify", () => {
  assert.equal(errorMessage({ code: "X" }), '{"code":"X"}');
});

test("errorMessage: circular object falls back to String()", () => {
  const obj: Record<string, unknown> = { a: 1 };
  obj.self = obj;
  // Should not throw — falls back to "[object Object]" or similar.
  const result = errorMessage(obj);
  assert.equal(typeof result, "string");
  assert.notEqual(result, "");
});

// ---------------------------------------------------------------------------
// getRequestId
// ---------------------------------------------------------------------------

test("getRequestId: generates UUID when header missing", () => {
  const req = new Request("http://x/");
  const id = getRequestId(req);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

test("getRequestId: echoes valid UUID from x-request-id header", () => {
  const incoming = "11111111-2222-3333-4444-555555555555";
  const req = new Request("http://x/", { headers: { "x-request-id": incoming } });
  assert.equal(getRequestId(req), incoming);
});

test("getRequestId: rejects malformed header and generates new UUID", () => {
  const req = new Request("http://x/", { headers: { "x-request-id": "not-a-uuid" } });
  const id = getRequestId(req);
  assert.notEqual(id, "not-a-uuid");
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

test("getRequestId: trims whitespace around valid header", () => {
  const incoming = "  11111111-2222-3333-4444-555555555555  ";
  const req = new Request("http://x/", { headers: { "x-request-id": incoming } });
  assert.equal(getRequestId(req), "11111111-2222-3333-4444-555555555555");
});

// ---------------------------------------------------------------------------
// logApiError
// ---------------------------------------------------------------------------

test("logApiError: emits single-line JSON to console.error with required fields", () => {
  const captured: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
  try {
    logApiError({
      route: "/api/sessions/[id]",
      method: "DELETE",
      requestId: "req-1",
      error: new Error("disk full"),
      status: 500,
    });
  } finally {
    console.error = original;
  }
  assert.equal(captured.length, 1);
  const parsed = JSON.parse(captured[0]) as Record<string, unknown>;
  assert.equal(parsed.level, "error");
  assert.equal(parsed.scope, "api");
  assert.equal(parsed.route, "/api/sessions/[id]");
  assert.equal(parsed.method, "DELETE");
  assert.equal(parsed.requestId, "req-1");
  assert.equal(parsed.status, 500);
  assert.equal(parsed.message, "disk full");
  assert.ok(typeof parsed.stack === "string" && (parsed.stack as string).includes("Error: disk full"));
});

test("logApiError: non-Error error does not include stack", () => {
  const captured: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
  try {
    logApiError({
      route: "/api/x",
      method: "GET",
      requestId: "req-2",
      error: "string-only",
    });
  } finally {
    console.error = original;
  }
  const parsed = JSON.parse(captured[0]) as Record<string, unknown>;
  assert.equal(parsed.message, "string-only");
  assert.equal("stack" in parsed, false);
});

test("logApiError: status and params are optional", () => {
  const captured: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
  try {
    logApiError({
      route: "/api/x",
      method: "GET",
      requestId: "req-3",
      error: new Error("e"),
    });
  } finally {
    console.error = original;
  }
  const parsed = JSON.parse(captured[0]) as Record<string, unknown>;
  assert.equal("status" in parsed, false);
  assert.equal("params" in parsed, false);
});

test("logApiError: includes params when provided", () => {
  const captured: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
  try {
    logApiError({
      route: "/api/agent/[id]",
      method: "POST",
      requestId: "req-4",
      error: new Error("e"),
      params: { id: "abc" },
    });
  } finally {
    console.error = original;
  }
  const parsed = JSON.parse(captured[0]) as Record<string, unknown>;
  assert.deepEqual(parsed.params, { id: "abc" });
});
