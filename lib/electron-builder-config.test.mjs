import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");

test("electron updater runtime dependencies are packaged with the Electron app", () => {
  const requiredPackages = [
    "electron-updater",
    "builder-util-runtime",
    "js-yaml",
    "lazy-val",
    "lodash.escaperegexp",
    "lodash.isequal",
    "tiny-typed-emitter",
    "debug",
    "sax",
    "argparse",
    "ms",
  ];

  for (const packageName of requiredPackages) {
    const escapedName = packageName.replace(".", "\\.");
    assert.match(config, new RegExp(`from: node_modules/${escapedName}`));
    assert.match(config, new RegExp(`to: app/node_modules/${escapedName}`));
  }
});
