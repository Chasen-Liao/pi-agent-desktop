/**
 * Electron-side CSP builder. Mirrors lib/csp.ts (electron tsc rootDir is electron/
 * only, so we cannot import from ../lib without expanding the electron build).
 * Keep in sync with lib/csp.ts — both are covered by lib/csp.test.ts contract
 * and electron structural tests on main.ts usage.
 */

export type ElectronCspPort = number;

export function buildElectronCspHeader(port: ElectronCspPort): string {
  return [
    "default-src 'self'",
    `connect-src 'self' http://127.0.0.1:${port} ws://127.0.0.1:${port}`,
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "frame-src 'self'",
    "media-src 'self' data:",
  ].join("; ");
}
