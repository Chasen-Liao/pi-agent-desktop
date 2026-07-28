/**
 * Canonical list of packages that must be copied into Electron extraResources
 * so electron-updater can load at runtime (app.asar does not include them).
 *
 * Keep electron-builder.yml extraResources in sync with this list.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

export const ELECTRON_UPDATER_RUNTIME_PACKAGES = Object.freeze([
  "electron-updater",
  "builder-util-runtime",
  "fs-extra",
  "graceful-fs",
  "jsonfile",
  "js-yaml",
  "lazy-val",
  "lodash.escaperegexp",
  "lodash.isequal",
  "semver",
  "tiny-typed-emitter",
  "universalify",
  "debug",
  "sax",
  "argparse",
  "ms",
]);

/**
 * Parse package names listed as `from: node_modules/<name>` → app/node_modules.
 */
export function parsePackagedUpdaterPackages(ymlText) {
  const found = new Set();
  const re = /from:\s*node_modules\/([^\s\n]+)\s*\n\s*to:\s*app\/node_modules\/\1/g;
  let m;
  while ((m = re.exec(ymlText)) !== null) {
    found.add(m[1]);
  }
  return found;
}

export function missingFromBuilderConfig(ymlText, required = ELECTRON_UPDATER_RUNTIME_PACKAGES) {
  const packaged = parsePackagedUpdaterPackages(ymlText);
  return required.filter((name) => !packaged.has(name));
}

/**
 * Verify each package is resolvable from project root (present in node_modules).
 */
export function missingFromNodeModules(projectRoot, required = ELECTRON_UPDATER_RUNTIME_PACKAGES) {
  const require = createRequire(join(projectRoot, "package.json"));
  const missing = [];
  for (const name of required) {
    try {
      require.resolve(name);
    } catch {
      if (!existsSync(join(projectRoot, "node_modules", name))) {
        missing.push(name);
      }
    }
  }
  return missing;
}

export function runElectronUpdaterDepsCheck(projectRoot) {
  const yml = readFileSync(join(projectRoot, "electron-builder.yml"), "utf8");
  const missingYml = missingFromBuilderConfig(yml);
  const missingNm = missingFromNodeModules(projectRoot);
  return { missingYml, missingNm, ok: missingYml.length === 0 && missingNm.length === 0 };
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const projectRoot = join(here, "..");
  const { missingYml, missingNm, ok } = runElectronUpdaterDepsCheck(projectRoot);
  if (!ok) {
    if (missingYml.length) {
      console.error("Missing from electron-builder.yml extraResources:", missingYml.join(", "));
    }
    if (missingNm.length) {
      console.error("Missing from node_modules:", missingNm.join(", "));
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `OK: ${ELECTRON_UPDATER_RUNTIME_PACKAGES.length} electron-updater runtime packages present in yml and node_modules`
  );
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry && process.argv.includes("--check")) {
  main();
}
