import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"],
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.*.*"],
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
  // Prevent release/ (electron-builder output) and other build artifacts
  // from being traced into the standalone output. Turbopack's NFT tracer can
  // include these large binaries (old installers, win-unpacked) which inflate
  // the NSIS installer with a recursive copy of itself.
  outputFileTracingExcludes: {
    "*": [
      "**/release/**",
      "**/.next/**",
      "**/node_modules/.cache/**",
    ],
  },
};

export default nextConfig;
