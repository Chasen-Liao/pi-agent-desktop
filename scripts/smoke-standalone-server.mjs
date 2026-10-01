import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("smoke-standalone-server: failed to allocate a test port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

async function waitForHealth(url, child, stderr, spawnError) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const startupError = spawnError();
    if (startupError) {
      throw new Error(`standalone server failed to start: ${startupError.message}${stderr()}`);
    }
    if (child.exitCode !== null) {
      throw new Error(
        `standalone server exited before health check (code ${child.exitCode})${stderr()}`
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.status === 200) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`standalone server did not become healthy within ${STARTUP_TIMEOUT_MS}ms${stderr()}`);
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (!child.pid) return;

  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    process.kill(-child.pid, "SIGTERM");
  }

  await Promise.race([
    exited,
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32" || !child.pid) child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
    await Promise.race([
      exited,
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
    ]);
  }
  if (child.exitCode === null && child.signalCode === null) {
    throw new Error(`standalone server process ${child.pid ?? "unknown"} did not exit`);
  }
}

async function getJsonArray(baseUrl, endpoint, key, stderr) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  if (response.status !== 200) {
    throw new Error(`GET ${endpoint} returned HTTP ${response.status}${stderr()}`);
  }
  const payload = JSON.parse(body);
  if (!Array.isArray(payload[key])) {
    throw new Error(`GET ${endpoint} did not return a ${key} array`);
  }
  return payload[key];
}

const sourceStandaloneDir = resolve(process.argv[2] ?? join(process.cwd(), ".next", "standalone"));
const runtimeExecutable = resolve(process.argv[3] ?? process.execPath);
const usesElectronRuntime = process.argv[3] !== undefined;
const sourceServerScript = join(sourceStandaloneDir, "server.js");
const piAiEntry = join(
  sourceStandaloneDir,
  "node_modules",
  "@earendil-works",
  "pi-ai",
  "dist",
  "index.js"
);

if (!existsSync(sourceServerScript)) {
  console.error(`smoke-standalone-server: server.js not found at ${sourceServerScript}`);
  process.exit(1);
}
if (!existsSync(piAiEntry)) {
  console.error(`smoke-standalone-server: Pi runtime entry not found at ${piAiEntry}`);
  process.exit(1);
}
if (!existsSync(runtimeExecutable)) {
  console.error(`smoke-standalone-server: runtime executable not found at ${runtimeExecutable}`);
  process.exit(1);
}

const isolatedRoot = mkdtempSync(join(tmpdir(), "pi-agent-standalone-smoke-"));
let child = null;

try {
  const standaloneDir = join(isolatedRoot, "standalone");
  cpSync(sourceStandaloneDir, standaloneDir, { recursive: true });
  const agentDir = join(isolatedRoot, "agent");
  const fixtureDir = join(agentDir, "sessions", "--standalone-smoke--");
  mkdirSync(fixtureDir, { recursive: true });
  const fixtureId = randomUUID();
  const fixtureEntries = [
    { type: "session", version: 3, id: fixtureId, timestamp: new Date().toISOString(), cwd: isolatedRoot },
    { type: "message", id: "smoke-message", parentId: null, timestamp: new Date().toISOString(), message: { role: "user", content: "standalone-export-fixture", timestamp: Date.now() } },
  ];
  writeFileSync(join(fixtureDir, `smoke_${fixtureId}.jsonl`), fixtureEntries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
  const serverScript = join(standaloneDir, "server.js");
  const port = await getFreePort();
  let stderrText = "";
  let childSpawnError = null;
  child = spawn(runtimeExecutable, [serverScript], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      PI_CODING_AGENT_DIR: agentDir,
      ...(usesElectronRuntime ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    stdio: ["ignore", "ignore", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  child.stderr?.on("data", (chunk) => {
    stderrText = `${stderrText}${chunk.toString()}`.slice(-8_000);
  });
  child.once("error", (error) => {
    childSpawnError = error;
  });
  const stderr = () => (stderrText.trim() ? `\n${stderrText.trim()}` : "");

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(`${baseUrl}/api/health`, child, stderr, () => childSpawnError);

  const sessions = await getJsonArray(baseUrl, "/api/sessions", "sessions", stderr);
  const providers = await getJsonArray(baseUrl, "/api/auth/providers", "providers", stderr);
  const exported = await fetch(`${baseUrl}/api/sessions/${fixtureId}/export?format=html`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const html = await exported.text();
  const embedded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/);
  if (exported.status !== 200 || !embedded) {
    throw new Error(`HTML export returned HTTP ${exported.status} or missing session data${stderr()}`);
  }
  const exportedData = JSON.parse(Buffer.from(embedded[1], "base64").toString("utf8"));
  if (exportedData.entries[0]?.message?.content !== "standalone-export-fixture") {
    throw new Error("HTML export did not preserve the fixture message");
  }

  console.log(
    `smoke-standalone-server: health 200, sessions 200 (${sessions.length}), auth providers 200 (${providers.length}), HTML export 200`
  );
} catch (error) {
  console.error(`smoke-standalone-server: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  try {
    if (child) await stopChild(child);
  } finally {
    rmSync(isolatedRoot, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}
