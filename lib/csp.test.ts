import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConnectSrc,
  buildElectronCspHeader,
  buildWebCspHeader,
  requiredBaseDirectivePrefixes,
} from "./csp.ts";
import { buildElectronCspHeader as buildElectronCspHeaderMain } from "../electron/csp.ts";

test("web CSP allows loopback port wildcard connect-src", () => {
  const header = buildWebCspHeader();
  assert.match(header, /default-src 'self'/);
  assert.match(header, /connect-src 'self' http:\/\/127\.0\.0\.1:\* ws:\/\/127\.0\.0\.1:\*/);
  assert.match(header, /img-src 'self' data: blob:/);
  assert.doesNotMatch(header, /https:\/\//);
});

test("electron CSP pins active port in connect-src", () => {
  const header = buildElectronCspHeader(30141);
  assert.match(header, /connect-src 'self' http:\/\/127\.0\.0\.1:30141 ws:\/\/127\.0\.0\.1:30141/);
  assert.doesNotMatch(header, /127\.0\.0\.1:\*/);
});

test("buildConnectSrc modes match header builders", () => {
  assert.equal(
    buildConnectSrc({ kind: "web" }),
    "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*"
  );
  assert.equal(
    buildConnectSrc({ kind: "electron", port: 9 }),
    "connect-src 'self' http://127.0.0.1:9 ws://127.0.0.1:9"
  );
});

test("required base directive prefixes appear in both variants", () => {
  const web = buildWebCspHeader();
  const electron = buildElectronCspHeader(1);
  for (const prefix of requiredBaseDirectivePrefixes()) {
    assert.ok(web.includes(prefix), `web missing ${prefix}`);
    assert.ok(electron.includes(prefix), `electron missing ${prefix}`);
  }
});

test("electron/csp.ts and lib/csp.ts emit byte-identical Electron CSP headers", () => {
  // Two independent copies of the directive table exist because the electron
  // tsc build has rootDir=electron/ and cannot import from ../lib. Without a
  // parity check they can drift silently, so pin them together here.
  for (const port of [1, 30141, 65535]) {
    assert.equal(
      buildElectronCspHeaderMain(port),
      buildElectronCspHeader(port),
      `CSP headers diverge between electron/csp.ts and lib/csp.ts on port ${port}`
    );
  }
});
