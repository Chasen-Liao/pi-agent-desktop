import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};

test("build scripts name the standalone Next.js build explicitly", () => {
  assert.equal(pkg.scripts["build:standalone"], "next build --webpack");
  assert.equal(pkg.scripts.build, "npm run build:standalone");
});

test("packaging and release scripts call build:standalone", () => {
  assert.match(pkg.scripts.release, /npm run build:standalone/);
  assert.match(pkg.scripts.pack, /^npm run build:standalone &&/);
  assert.match(pkg.scripts.dist, /^npm run build:standalone &&/);
});
