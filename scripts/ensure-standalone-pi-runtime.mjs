/**
 * Next.js standalone tracing can copy an external Pi package without its
 * production dependencies. Copy the complete installed runtime dependency
 * closure while preserving npm's node_modules layout.
 */
import { cpSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const projectRoot = process.cwd();
const sourceNodeModules = join(projectRoot, "node_modules");
const standaloneNodeModules = join(projectRoot, ".next", "standalone", "node_modules");
const roots = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"];

function packageDirectory(name, fromDirectory) {
  let current = fromDirectory;
  const packageParts = name.split("/");

  while (true) {
    const candidate = join(current, "node_modules", ...packageParts);
    if (existsSync(join(candidate, "package.json"))) return candidate;

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readManifest(directory) {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
}

if (!existsSync(standaloneNodeModules)) {
  console.error("ensure-standalone-pi-runtime: .next/standalone/node_modules not found");
  process.exit(1);
}

const queue = roots.map((name) => ({
  name,
  directory: packageDirectory(name, projectRoot),
  required: true,
}));
const visited = new Set();
let copied = 0;

while (queue.length > 0) {
  const item = queue.shift();
  if (!item.directory) {
    if (item.required) {
      console.error(`ensure-standalone-pi-runtime: required package ${item.name} not found`);
      process.exit(1);
    }
    continue;
  }

  const sourceDirectory = realpathSync(item.directory);
  if (visited.has(sourceDirectory)) continue;
  visited.add(sourceDirectory);

  const relativeDirectory = relative(sourceNodeModules, sourceDirectory);
  if (relativeDirectory.startsWith("..")) {
    console.error(`ensure-standalone-pi-runtime: package escaped node_modules: ${sourceDirectory}`);
    process.exit(1);
  }

  cpSync(sourceDirectory, join(standaloneNodeModules, relativeDirectory), {
    recursive: true,
    force: true,
  });
  copied += 1;

  const manifest = readManifest(sourceDirectory);
  const requiredDependencies = Object.keys(manifest.dependencies ?? {});
  const optionalDependencies = Object.keys(manifest.optionalDependencies ?? {});
  const peerDependencies = Object.keys(manifest.peerDependencies ?? {});

  for (const dependency of requiredDependencies) {
    queue.push({
      name: dependency,
      directory: packageDirectory(dependency, sourceDirectory),
      required: true,
    });
  }
  for (const dependency of [...optionalDependencies, ...peerDependencies]) {
    queue.push({
      name: dependency,
      directory: packageDirectory(dependency, sourceDirectory),
      required: false,
    });
  }
}

console.log(`ensure-standalone-pi-runtime: copied ${copied} runtime packages`);
