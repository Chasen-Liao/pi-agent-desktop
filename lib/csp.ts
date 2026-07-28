/**
 * Shared CSP directive builders for Web (middleware) and Electron (main process).
 * Keep directive sets aligned; only connect-src differs by environment.
 */

export type CspConnectMode =
  | { kind: "web" }
  | { kind: "electron"; port: number };

const BASE_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "frame-src 'self'",
  "media-src 'self' data:",
];

/**
 * Build connect-src for the given runtime.
 * Web allows any loopback port (dev + next); Electron pins the active port.
 */
export function buildConnectSrc(mode: CspConnectMode): string {
  if (mode.kind === "web") {
    return "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*";
  }
  const port = mode.port;
  return `connect-src 'self' http://127.0.0.1:${port} ws://127.0.0.1:${port}`;
}

/** Full CSP header value (semicolon-separated directives). */
export function buildCspHeader(mode: CspConnectMode): string {
  const connect = buildConnectSrc(mode);
  // Order: default, connect near top after default for readability parity with prior headers
  return [
    BASE_DIRECTIVES[0],
    connect,
    ...BASE_DIRECTIVES.slice(1),
  ].join("; ");
}

export function buildWebCspHeader(): string {
  return buildCspHeader({ kind: "web" });
}

export function buildElectronCspHeader(port: number): string {
  return buildCspHeader({ kind: "electron", port });
}

/** Directives that must appear in every CSP variant (excluding connect-src). */
export function requiredBaseDirectivePrefixes(): readonly string[] {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "frame-src 'self'",
    "media-src 'self'",
  ];
}
