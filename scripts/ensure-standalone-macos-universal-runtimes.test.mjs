import assert from "node:assert/strict";
import test from "node:test";
import { requiredDarwinSharpPackages, requiredDarwinEsbuildPackages } from "./ensure-standalone-macos-universal-runtimes.mjs";

test("selects both macOS esbuild binaries at the JavaScript API version", () => {
  assert.deepEqual(requiredDarwinEsbuildPackages({
    version: "0.28.2",
    optionalDependencies: {
      "@esbuild/darwin-arm64": "0.28.2",
      "@esbuild/darwin-x64": "0.28.2",
      "@esbuild/linux-x64": "0.28.2",
    },
  }), [
    { name: "@esbuild/darwin-arm64", version: "0.28.2" },
    { name: "@esbuild/darwin-x64", version: "0.28.2" },
  ]);
  assert.throws(() => requiredDarwinEsbuildPackages({
    version: "0.28.2",
    optionalDependencies: { "@esbuild/darwin-arm64": "0.28.1" },
  }), /expected esbuild optional dependency/);
});

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
