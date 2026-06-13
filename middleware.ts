import { NextResponse } from "next/server";

export function middleware() {
  const response = NextResponse.next();
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
      "font-src 'self' data:",
      "frame-src 'self'",
      "media-src 'self' data:",
    ].join("; ")
  );
  return response;
}

export const config = {
  matcher: "/((?!api|_next/static|_next/image|favicon.ico).*)",
};
