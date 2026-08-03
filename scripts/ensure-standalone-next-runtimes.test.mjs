import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./ensure-standalone-next-runtimes.mjs", import.meta.url));

test("ensure-standalone-next-runtimes copies turbo prod runtimes into standalone", () => {
  const root = mkdtempSync(join(tmpdir(), "ensure-turbo-"));
  try {
    const src = join(root, "node_modules", "next", "dist", "compiled", "next-server");
    const dst = join(
      root,
      ".next",
      "standalone",
      "node_modules",
      "next",
      "dist",
      "compiled",
      "next-server"
    );
    mkdirSync(src, { recursive: true });
    mkdirSync(join(root, ".next", "standalone"), { recursive: true });
    // dest may not exist yet — script creates it
    writeFileSync(join(src, "app-route-turbo.runtime.prod.js"), "/* route turbo */\n");
    writeFileSync(join(src, "app-page-turbo.runtime.prod.js"), "/* page turbo */\n");
    writeFileSync(join(src, "app-route-turbo.runtime.dev.js"), "/* should skip */\n");
    writeFileSync(join(src, "app-route.runtime.prod.js"), "/* non-turbo skip */\n");

    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(existsSync(join(dst, "app-route-turbo.runtime.prod.js")));
    assert.ok(existsSync(join(dst, "app-page-turbo.runtime.prod.js")));
    assert.equal(existsSync(join(dst, "app-route-turbo.runtime.dev.js")), false);
    assert.equal(
      readFileSync(join(dst, "app-route-turbo.runtime.prod.js"), "utf8"),
      "/* route turbo */\n"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
