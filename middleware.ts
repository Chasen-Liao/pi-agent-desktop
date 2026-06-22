import { NextRequest, NextResponse } from "next/server";

// Allowed origins: localhost / 127.0.0.1 on http or https, with optional port.
// LAN IPs (e.g. 192.168.x.x) are intentionally NOT allowed — they cannot reach
// the dev server in browser mode and only broaden the DNS-rebinding surface.
const ALLOWED_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Returns true if the given Origin header value points at localhost or the
 * loopback address. Exported for unit testing.
 */
export function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGIN_RE.test(origin);
}

// CSP header value — identical to the previous proxy.ts. Matcher (see `config`
// below) already excludes /api, /_next/static, /_next/image, /favicon.ico, so
// this header is only injected into HTML page responses.
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
 * Next.js middleware. Injects the Content-Security-Policy header on page
 * responses and blocks non-GET requests from disallowed origins (mitigates
 * DNS rebinding and simple cross-origin write attacks against the loopback
 * dev server). Requests without an Origin header (e.g. curl, some Electron
 * renderer fetches) bypass the check for backward compatibility — browsers
 * always send Origin on cross-origin writes.
 */
export function middleware(request: NextRequest): NextResponse {
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin !== null && !isAllowedOrigin(origin)) {
      return new NextResponse(JSON.stringify({ error: "forbidden origin" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
  }

  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", CSP_HEADER);
  return response;
}

export const config = {
  matcher: "/((?!api|_next/static|_next/image|favicon.ico).*)",
};
