import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDir, "..");
const releaseDir = join(projectRoot, "release");

function hasStandaloneServer(path) {
  return existsSync(join(path, "server.js"));
}

function findPackagedStandalone() {
  if (!existsSync(releaseDir)) return null;

  if (process.platform === "win32") {
    const windows = join(releaseDir, "win-unpacked", "resources", "standalone");
    return hasStandaloneServer(windows) ? windows : null;
  }

  if (process.platform === "linux") {
    const linux = join(releaseDir, "linux-unpacked", "resources", "standalone");
    return hasStandaloneServer(linux) ? linux : null;
  }

  const macDir = join(releaseDir, "mac");
  if (process.platform === "darwin" && existsSync(macDir)) {
    for (const entry of readdirSync(macDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith(".app")) continue;
      const mac = join(macDir, entry.name, "Contents", "Resources", "standalone");
      if (hasStandaloneServer(mac)) return mac;
    }
  }

  return null;
}

const standaloneDir = findPackagedStandalone();
if (!standaloneDir) {
  console.error(`smoke-packaged-standalone: packaged standalone not found under ${releaseDir}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [join(scriptsDir, "smoke-standalone-server.mjs"), standaloneDir],
  {
    cwd: projectRoot,
    stdio: "inherit",
    windowsHide: true,
  }
);

if (result.error) {
  console.error(`smoke-packaged-standalone: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
