/**
 * A Next.js standalone build only traces native optional dependencies for the
 * host architecture. A Universal macOS app needs Sharp's arm64 and x64
 * packages side-by-side because Sharp selects the package using process.arch.
 *
 * Copy packages already installed for the host and fetch only the missing
 * architecture packages with `npm pack`. `npm install` cannot install an
 * x64-only optional package while running on Apple Silicon (EBADPLATFORM).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DARWIN_SHARP_PACKAGE =
  /^@img\/(?:sharp|sharp-libvips)-darwin-(?:arm64|x64)$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function requiredDarwinSharpPackages(sharpManifest) {
  const packages = Object.entries(sharpManifest.optionalDependencies ?? {})
    .filter(([name]) => DARWIN_SHARP_PACKAGE.test(name))
    .map(([name, version]) => ({ name, version }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const expectedNames = [
    "@img/sharp-darwin-arm64",
    "@img/sharp-darwin-x64",
    "@img/sharp-libvips-darwin-arm64",
    "@img/sharp-libvips-darwin-x64",
  ];
  const actualNames = packages.map(({ name }) => name);
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `expected Sharp optional dependencies ${expectedNames.join(", ")}; got ${actualNames.join(", ")}`,
    );
  }

  return packages;
}

function packageDirectory(nodeModules, name) {
  return join(nodeModules, ...name.split("/"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.captureStdout
      ? ["ignore", "pipe", "inherit"]
      : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${basename(command)} exited with status ${result.status}`);
  }
  return result.stdout ?? "";
}

function npmPack(spec, destination, cwd) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : "npm";
  const prefixArgs = npmExecPath ? [npmExecPath] : [];
  const stdout = run(
    command,
    [
      ...prefixArgs,
      "pack",
      spec,
      "--json",
      "--pack-destination",
      destination,
    ],
    { cwd, captureStdout: true },
  );
  const result = JSON.parse(stdout);
  const filename = result?.[0]?.filename;
  if (typeof filename !== "string" || !filename.endsWith(".tgz")) {
    throw new Error(`npm pack did not return a tarball filename for ${spec}`);
  }
  return join(destination, filename);
}

function extractPackage(archive, destination) {
  mkdirSync(destination, { recursive: true });
  run("tar", [
    "-xzf",
    archive,
    "-C",
    destination,
    "--strip-components=1",
  ]);
}

export function ensureStandaloneMacUniversalRuntimes(projectRoot) {
  const sourceNodeModules = join(projectRoot, "node_modules");
  const standaloneNodeModules = join(
    projectRoot,
    ".next",
    "standalone",
    "node_modules",
  );
  const sharpManifestPath = join(
    standaloneNodeModules,
    "sharp",
    "package.json",
  );
  if (!existsSync(sharpManifestPath)) {
    throw new Error(
      "standalone sharp package not found (run next build before preparing Universal runtimes)",
    );
  }

  const requiredPackages = requiredDarwinSharpPackages(
    readJson(sharpManifestPath),
  );
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "pi-agent-macos-universal-"),
  );
  let copied = 0;
  let fetched = 0;

  try {
    for (const { name, version } of requiredPackages) {
      const destination = packageDirectory(standaloneNodeModules, name);
      const destinationManifest = join(destination, "package.json");
      if (existsSync(destinationManifest)) {
        const installed = readJson(destinationManifest);
        if (installed.version !== version) {
          throw new Error(
            `${name} version mismatch in standalone: expected ${version}, got ${installed.version}`,
          );
        }
        continue;
      }

      const source = packageDirectory(sourceNodeModules, name);
      if (existsSync(join(source, "package.json"))) {
        cpSync(source, destination, { recursive: true, force: true });
        copied += 1;
      } else {
        const archive = npmPack(
          `${name}@${version}`,
          temporaryDirectory,
          projectRoot,
        );
        extractPackage(archive, destination);
        fetched += 1;
      }

      const installed = readJson(destinationManifest);
      if (installed.name !== name || installed.version !== version) {
        throw new Error(
          `invalid package extracted for ${name}@${version}`,
        );
      }
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  console.log(
    `ensure-standalone-macos-universal-runtimes: ready (${copied} copied, ${fetched} fetched)`,
  );
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  if (process.platform !== "darwin") {
    console.log(
      "ensure-standalone-macos-universal-runtimes: skipped (not macOS)",
    );
  } else {
    try {
      ensureStandaloneMacUniversalRuntimes(process.cwd());
    } catch (error) {
      console.error(
        `ensure-standalone-macos-universal-runtimes: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  }
}
