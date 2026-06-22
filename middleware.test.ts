import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Loader stub for `next/server`
// ---------------------------------------------------------------------------
// node 24's ESM resolver does not auto-append `.js` for packages without an
// `exports` map (next 16 has none), so `import "next/server"` fails under
// `node --test`. We register an inline resolve hook that redirects
// `next/server` to a minimal stub, letting us load the *real* middleware.ts
// and exercise its actual `isAllowedOrigin` function. The middleware()
// function itself depends on NextRequest and is intentionally not unit-tested
// here (per task spec).
const LOADER_SOURCE = `
export function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") {
    const stub =
      "export class NextResponse { static next() { return new NextResponse(); } }" +
      "export class NextRequest {}";
    return {
      url: "data:text/javascript," + encodeURIComponent(stub),
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
`;
register(
  "data:text/javascript," + encodeURIComponent(LOADER_SOURCE),
  import.meta.url,
);

const { isAllowedOrigin } = await import("./middleware.ts");

// ---------------------------------------------------------------------------
// isAllowedOrigin — loopback / localhost allowlist
// ---------------------------------------------------------------------------

test("isAllowedOrigin: http://localhost with port is allowed", () => {
  assert.equal(isAllowedOrigin("http://localhost:30141"), true);
});

test("isAllowedOrigin: http://127.0.0.1 with port is allowed", () => {
  assert.equal(isAllowedOrigin("http://127.0.0.1:30141"), true);
});

test("isAllowedOrigin: https://localhost / https://127.0.0.1 with port are allowed", () => {
  assert.equal(isAllowedOrigin("https://localhost:30141"), true);
  assert.equal(isAllowedOrigin("https://127.0.0.1:30141"), true);
});

test("isAllowedOrigin: loopback without port is allowed (dev convenience)", () => {
  assert.equal(isAllowedOrigin("http://localhost"), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1"), true);
});

test("isAllowedOrigin: cross-origin host is rejected", () => {
  assert.equal(isAllowedOrigin("https://evil.com"), false);
});

test("isAllowedOrigin: LAN IP is rejected (only loopback allowed)", () => {
  assert.equal(isAllowedOrigin("http://192.168.1.1:30141"), false);
  assert.equal(isAllowedOrigin("http://10.0.0.1:30141"), false);
});

test("isAllowedOrigin: empty string is rejected", () => {
  assert.equal(isAllowedOrigin(""), false);
});

test("isAllowedOrigin: missing scheme / malformed values are rejected", () => {
  assert.equal(isAllowedOrigin("localhost:30141"), false);
  assert.equal(isAllowedOrigin("//localhost:30141"), false);
  assert.equal(isAllowedOrigin("file:///etc/passwd"), false);
});
