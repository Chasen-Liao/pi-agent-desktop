import { NextRequest, NextResponse } from "next/server";

// Allowed origins: localhost / 127.0.0.1 on http or https, with optional port.
// LAN IPs (e.g. 192.168.x.x) are intentionally NOT allowed — they cannot reach
// the dev server in browser mode and only broaden the DNS-rebinding surface.
// The `i` flag makes the scheme/host match case-insensitive (Origin headers
// are technically case-insensitive per RFC 6454).
const ALLOWED_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

/**
 * Returns true if the given Origin header value points at localhost or the
 * loopback address. Exported for unit testing.
 */
export function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGIN_RE.test(origin);
}

// CSP header value — identical to the previous proxy.ts. Only injected into
// HTML page responses (see `middleware` below); API responses are JSON and
// CSP has no meaning there.
const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
  "font-src 'self' data:",
  "frame-src 'self'",
  "media-src 'self' data:",
].join("; ");

/**
 * Decides whether the middleware should run the Origin check for a given
 * request. Only non-GET requests to /api/* are checked: pages are typically
 * loaded via GET (and are protected by CSP), while API writes (POST/PUT/
 * DELETE/PATCH) are the actual target of DNS-rebinding / cross-origin write
 * attacks against the loopback dev server.
 *
 * Exported for unit testing.
 */
export function shouldApplyOriginCheck(pathname: string, method: string): boolean {
  // Defensive: normalize to upper-case so a hypothetical lower-case method
  // (RFC 7231 & Next.js both uppercase it, but we don't depend on that) is
  // still treated as the write operation it is.
  return pathname.startsWith("/api") && method.toUpperCase() !== "GET";
}

/**
 * Next.js middleware. Two responsibilities, dispatched by pathname:
 *
 *   - /api/* requests: run the Origin check on non-GET methods (blocks DNS
 *     rebinding / cross-origin writes against the dev server). CSP is NOT
 *     injected — API responses are JSON and CSP is meaningless there.
 *   - page requests (anything else): inject the Content-Security-Policy
 *     header. No Origin check — pages are mostly GET and CSP is the
 *     page-level defense.
 *
 * Requests without an Origin header (e.g. curl, some Electron renderer
 * fetches) bypass the check for backward compatibility — browsers always
 * send Origin on cross-origin writes.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (shouldApplyOriginCheck(pathname, request.method)) {
    const origin = request.headers.get("origin");
    if (origin !== null && !isAllowedOrigin(origin)) {
      return new NextResponse(JSON.stringify({ error: "forbidden origin" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    return NextResponse.next();
  }

  // Page request: inject CSP.
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", CSP_HEADER);
  return response;
}

// Matcher includes /api so that the Origin check actually runs on API write
// requests (POST /api/agent/[id], etc.) — the previous matcher excluded /api
// entirely, which defeated the entire point of the Origin check. Only
// Next.js internal static assets and the favicon are bypassed.
export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
