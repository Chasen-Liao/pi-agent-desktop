import assert from "node:assert/strict";
import test from "node:test";
import { requiredDarwinSharpPackages } from "./ensure-standalone-macos-universal-runtimes.mjs";

test("selects both macOS architectures from Sharp optional dependencies", () => {
  const packages = requiredDarwinSharpPackages({
    optionalDependencies: {
      "@img/sharp-linux-x64": "0.35.3",
      "@img/sharp-libvips-darwin-x64": "1.3.2",
      "@img/sharp-darwin-arm64": "0.35.3",
      "@img/sharp-darwin-x64": "0.35.3",
      "@img/sharp-libvips-darwin-arm64": "1.3.2",
    },
  });

  assert.deepEqual(packages, [
    { name: "@img/sharp-darwin-arm64", version: "0.35.3" },
    { name: "@img/sharp-darwin-x64", version: "0.35.3" },
    { name: "@img/sharp-libvips-darwin-arm64", version: "1.3.2" },
    { name: "@img/sharp-libvips-darwin-x64", version: "1.3.2" },
  ]);
});

test("fails closed when Sharp's macOS optional dependency set changes", () => {
  assert.throws(
    () =>
      requiredDarwinSharpPackages({
        optionalDependencies: {
          "@img/sharp-darwin-arm64": "0.35.3",
        },
      }),
    /expected Sharp optional dependencies/,
  );
});
