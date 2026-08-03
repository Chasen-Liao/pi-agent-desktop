/**
 * Next.js 16 Turbopack production builds often omit app-route turbo runtime
 * files from the standalone NFT trace. Packaged Electron then fails to load
 * API routes with:
 *   Cannot find module 'next/dist/compiled/next-server/app-route-turbo.runtime.prod.js'
 *
 * Copy all *turbo*.runtime.prod.js files into standalone after `next build`.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
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

if (!existsSync(join(root, ".next", "standalone"))) {
  console.error("ensure-standalone-next-runtimes: .next/standalone not found (run next build first)");
  process.exit(1);
}
if (!existsSync(src)) {
  console.error("ensure-standalone-next-runtimes: next compiled next-server not found");
  process.exit(1);
}

mkdirSync(dst, { recursive: true });

const names = readdirSync(src).filter(
  (name) => name.includes("turbo") && name.endsWith(".runtime.prod.js")
);

if (names.length === 0) {
  console.error("ensure-standalone-next-runtimes: no turbo runtime.prod.js files in next package");
  process.exit(1);
}

for (const name of names) {
  cpSync(join(src, name), join(dst, name));
  console.log(`ensure-standalone-next-runtimes: ${name}`);
}
