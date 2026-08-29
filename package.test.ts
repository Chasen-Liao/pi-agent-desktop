import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};

test("build scripts name the standalone Next.js build explicitly", () => {
  assert.match(pkg.scripts["build:standalone"], /^next build\b/);
  assert.match(
    pkg.scripts["build:standalone"],
    /ensure-standalone-next-runtimes\.mjs/
  );
  assert.match(
    pkg.scripts["build:standalone"],
    /smoke-standalone-server\.mjs/
  );
  assert.match(
    pkg.scripts["build:standalone"],
    /ensure-standalone-pi-runtime\.mjs/
  );
  assert.match(
    pkg.scripts["build:standalone"],
    /ensure-standalone-macos-universal-runtimes\.mjs/
  );
  assert.equal(pkg.scripts.build, "npm run build:standalone");
});

test("packaging and release scripts call build:standalone", () => {
  assert.match(pkg.scripts.release, /npm run build:standalone/);
  assert.match(pkg.scripts.pack, /^npm run build:standalone &&/);
  assert.match(pkg.scripts.dist, /^npm run build:standalone &&/);
  for (const scriptName of ["pack", "dist"]) {
    assert.match(
      pkg.scripts[scriptName],
      /electron-builder.+&& node scripts\/smoke-packaged-standalone\.mjs/
    );
  }
  assert.match(pkg.scripts["pack:mac"], /electron-builder --mac --universal --dir/);
  assert.match(pkg.scripts["dist:mac"], /electron-builder --mac --universal --publish never/);
  for (const scriptName of ["pack:mac", "dist:mac"]) {
    assert.match(pkg.scripts[scriptName], /^npm run build:standalone &&/);
    assert.match(pkg.scripts[scriptName], /&& node scripts\/smoke-packaged-standalone\.mjs$/);
  }
  for (const scriptName of ["pack", "pack:mac", "dist", "dist:mac"]) {
    assert.doesNotMatch(
      pkg.scripts[scriptName],
      /@electron\/rebuild/,
      "electron-builder already rebuilds native dependencies",
    );
  }
});

test("test scripts cover middleware and scope platform-specific desktop subsets", () => {
  // node:test does not exit after passing (open sqlite/server handles), so both
  // scripts keep --test-force-exit. Removing it hangs the suite.
  assert.match(pkg.scripts.test, /--test-force-exit/);
  assert.match(
    pkg.scripts.test,
    /"middleware\.test\.ts"/,
    "full suite must run root middleware.test.ts"
  );
  const windowsScript = pkg.scripts["test:windows"];
  assert.ok(windowsScript, "test:windows script must exist");
  assert.match(windowsScript, /^node --test --test-force-exit /);
  assert.match(
    windowsScript,
    /"electron\/\*\*\/\*\.test\.ts"/,
    "Windows subset must include electron/**/*.test.ts"
  );
  // middleware.test.ts is a Next.js web-server concern, not a Windows-path
  // concern — it is covered by the full suite and must not run twice.
  assert.doesNotMatch(windowsScript, /middleware\.test\.ts/);

  const macosScript = pkg.scripts["test:macos"];
  assert.ok(macosScript, "test:macos script must exist");
  assert.match(macosScript, /^node --test --test-force-exit /);
  assert.match(macosScript, /"electron\/\*\*\/\*\.test\.ts"/);
  assert.match(macosScript, /"lib\/electron-\*\.test\.mjs"/);
  assert.match(
    macosScript,
    /ensure-standalone-macos-universal-runtimes\.test\.mjs/,
  );
  assert.doesNotMatch(macosScript, /middleware\.test\.ts/);
});

test("next.config tracing excludes test files from the standalone output", () => {
  const config = readFileSync(new URL("./next.config.ts", import.meta.url), "utf8");
  const block = config.slice(
    config.indexOf("outputFileTracingExcludes"),
    config.indexOf("env:")
  );
  assert.ok(block.includes("outputFileTracingExcludes"), "tracing excludes block expected");
  for (const pattern of [
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.test.mjs",
    "**/*.test.js",
    "middleware.test.ts",
    "package.test.ts",
  ]) {
    assert.ok(block.includes(pattern), `outputFileTracingExcludes must contain ${pattern}`);
  }
});

test("packaged smoke test targets Windows and architecture-suffixed macOS outputs", () => {
  const script = readFileSync(
    new URL("./scripts/smoke-packaged-standalone.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    script,
    /join\(outputDir, "resources", "standalone"\)/
  );
  assert.match(
    script,
    /join\(outputDir, "Pi Agent Desktop\.exe"\)/
  );
  assert.match(script, /\^mac\(\?:-\(\?:arm64\|x64\|universal\)\)\?\$/);
  assert.match(script, /join\(appDir, "Resources", "standalone"\)/);
  assert.match(
    readFileSync(
      new URL("./scripts/smoke-standalone-server.mjs", import.meta.url),
      "utf8"
    ),
    /ELECTRON_RUN_AS_NODE/
  );
  assert.match(
    readFileSync(
      new URL("./scripts/smoke-standalone-server.mjs", import.meta.url),
      "utf8"
    ),
    /child\.once\("error"/
  );
});
