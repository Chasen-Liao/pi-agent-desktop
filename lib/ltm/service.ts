import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { MemoryBackend } from "./backend.ts";
import { AgentMemoryRestBackend } from "./agentmemory-backend.ts";
import { getLtmConfig, type LtmConfig } from "./config.ts";
import { LTM_STATS_NOT_SUPPORTED } from "./http.ts";
import { projectIdFromCwd } from "./project-id.ts";
import { SqliteBackend } from "./sqlite-backend.ts";
import type {
  ForgetInput,
  MemoryType,
  ObserveInput,
  RecallHit,
  RecallInput,
  RememberInput,
} from "./types.ts";

const DISABLED_ERROR = "ltm_disabled";

/** How long a cached backend-construction failure is trusted before the
 * singleton retries construction once (see getMemoryService). */
export const LTM_FAILURE_RETRY_MS = 30_000;

export type RememberFromCwdInput = Omit<RememberInput, "projectId">;
export type RecallFromCwdInput = Omit<RecallInput, "projectId">;
export type ObserveFromCwdInput = Omit<ObserveInput, "projectId">;
export type ForgetFromCwdInput = Omit<ForgetInput, "projectId">;

type LtmServiceGlobal = {
  __piLtmService?: MemoryService;
  __piLtmServiceKey?: string;
  __piLtmServiceError?: unknown;
  __piLtmServiceErrorAt?: number;
};

function ltmGlobal(): LtmServiceGlobal {
  return globalThis as typeof globalThis & LtmServiceGlobal;
}

/** Placeholder used when LTM is disabled: never touches disk. Service methods
 * short-circuit on enabled=false, so this only needs to satisfy the interface. */
class NoopMemoryBackend implements MemoryBackend {
  async remember(input: RememberInput): Promise<{ id: string; type: MemoryType }> {
    void input;
    throw new Error(DISABLED_ERROR);
  }
  async recall(input: RecallInput): Promise<RecallHit[]> {
    void input;
    throw new Error(DISABLED_ERROR);
  }
  async observe(input: ObserveInput): Promise<{ observationId: string } | { deduplicated: true }> {
    void input;
    return { deduplicated: true };
  }
  async forget(input: ForgetInput): Promise<{ deleted: number }> {
    void input;
    throw new Error(DISABLED_ERROR);
  }
  async health(): Promise<{ ok: boolean; backend: string; detail?: string }> {
    return { ok: false, backend: "disabled", detail: DISABLED_ERROR };
  }
}

function createBackend(config: LtmConfig): MemoryBackend {
  if (!config.enabled) {
    // Disabled: no mkdir / open / schema. Prevents a read-only or missing
    // directory from turning a disabled feature into 500s and error logs.
    return new NoopMemoryBackend();
  }
  if (config.backend === "agentmemory") {
    return new AgentMemoryRestBackend(config.agentmemoryUrl);
  }
  return new SqliteBackend(config.dbPath);
}

function serviceKey(config: LtmConfig): string {
  // JSON.stringify (not join("|")) so a free-text dbPath containing "|" cannot
  // collide with another config (e.g. ".../mem|true" shifting a boolean token).
  return JSON.stringify([
    config.backend,
    config.dbPath,
    config.enabled,
    config.observeAgentEnd,
    config.observePreCompact,
    config.agentmemoryUrl,
  ]);
}

export class MemoryService {
  private readonly config: LtmConfig;
  private readonly backend: MemoryBackend;

  private constructor(config: LtmConfig, backend: MemoryBackend) {
    this.config = config;
    this.backend = backend;
  }

  /** Testable factory: builds a service from an explicit config (no globalThis). */
  static create(config: LtmConfig): MemoryService {
    return new MemoryService(config, createBackend(config));
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getConfig(): Readonly<LtmConfig> {
    return this.config;
  }

  async health(): Promise<{ ok: boolean; backend: string; detail?: string }> {
    if (!this.config.enabled) {
      return { ok: false, backend: this.config.backend, detail: DISABLED_ERROR };
    }
    return this.backend.health();
  }

  async rememberFromCwd(
    cwd: string,
    input: RememberFromCwdInput
  ): Promise<{ id: string; type: MemoryType }> {
    this.assertEnabled();
    return this.backend.remember({
      ...input,
      projectId: projectIdFromCwd(cwd),
    });
  }

  async recallFromCwd(
    cwd: string,
    input: RecallFromCwdInput
  ): Promise<RecallHit[]> {
    this.assertEnabled();
    return this.backend.recall({
      ...input,
      projectId: projectIdFromCwd(cwd),
    });
  }

  /**
   * Observe path for hooks: silent no-op when LTM is disabled.
   * Returns `{ deduplicated: true }` when skipped (disabled).
   */
  async observeFromCwd(
    cwd: string,
    input: ObserveFromCwdInput
  ): Promise<{ observationId: string } | { deduplicated: true }> {
    if (!this.config.enabled) {
      return { deduplicated: true };
    }
    return this.backend.observe({
      ...input,
      projectId: projectIdFromCwd(cwd),
    });
  }

  /** Alias for hooks: same as observeFromCwd (no-ops when disabled). */
  async safeObserve(
    cwd: string,
    input: ObserveFromCwdInput
  ): Promise<{ observationId: string } | { deduplicated: true }> {
    return this.observeFromCwd(cwd, input);
  }

  async forgetFromCwd(
    cwd: string,
    input: ForgetFromCwdInput
  ): Promise<{ deleted: number }> {
    this.assertEnabled();
    return this.backend.forget({
      ...input,
      projectId: projectIdFromCwd(cwd),
    });
  }

  async statsFromCwd(
    cwd: string
  ): Promise<{ memoryCount: number; observationCount: number }> {
    this.assertEnabled();
    const projectId = projectIdFromCwd(cwd);
    if (this.backend instanceof SqliteBackend) {
      return this.backend.stats(projectId);
    }
    throw new Error(LTM_STATS_NOT_SUPPORTED);
  }

  async close(): Promise<void> {
    await this.backend.close?.();
  }

  private assertEnabled(): void {
    if (!this.config.enabled) {
      throw new Error(DISABLED_ERROR);
    }
  }
}

/**
 * Process-wide singleton (HMR-safe via globalThis).
 * Keyed by a JSON encoding of backend|dbPath|enabled|observe flags|agentmemoryUrl
 * so config changes get a fresh instance.
 */
export function getMemoryService(agentDir?: string): MemoryService {
  const dir = agentDir ?? getAgentDir();
  const config = getLtmConfig(dir);
  const key = serviceKey(config);
  const g = ltmGlobal();

  if (g.__piLtmService && g.__piLtmServiceKey === key) {
    return g.__piLtmService;
  }
  // A previous construction attempt for this exact config failed: throw the
  // cached failure instead of rebuilding (and re-logging) on every hook/tool
  // call. A config change produces a different key and retries fresh.
  // The cache only lives for LTM_FAILURE_RETRY_MS — a transient root cause
  // (disk full, AV lock, directory in use) must not disable LTM for the rest
  // of the session.
  if (g.__piLtmServiceKey === key && g.__piLtmServiceError !== undefined) {
    const errorAt = g.__piLtmServiceErrorAt ?? 0;
    if (Date.now() - errorAt < LTM_FAILURE_RETRY_MS) {
      throw g.__piLtmServiceError;
    }
    // TTL expired: drop the cached failure so the next construction retries once.
    g.__piLtmServiceError = undefined;
    g.__piLtmServiceErrorAt = undefined;
  }

  const previous = g.__piLtmService;
  let next: MemoryService;
  try {
    next = MemoryService.create(config);
  } catch (err) {
    g.__piLtmService = undefined;
    g.__piLtmServiceKey = key;
    g.__piLtmServiceError = err;
    g.__piLtmServiceErrorAt = Date.now();
    // Best-effort close of the instance we are replacing — otherwise a
    // failed config migration leaks the old DatabaseSync handle (Windows
    // keeps the WAL file open).
    if (previous) {
      void previous.close().catch(() => {});
    }
    throw err;
  }
  g.__piLtmService = next;
  g.__piLtmServiceKey = key;
  g.__piLtmServiceError = undefined;
  g.__piLtmServiceErrorAt = undefined;

  // Best-effort close of previous instance (different dbPath / config).
  if (previous) {
    void previous.close().catch(() => {});
  }

  return next;
}

/** Test helper: clear the process singleton. */
export function resetMemoryServiceForTests(): void {
  const g = ltmGlobal();
  const prev = g.__piLtmService;
  g.__piLtmService = undefined;
  g.__piLtmServiceKey = undefined;
  g.__piLtmServiceError = undefined;
  g.__piLtmServiceErrorAt = undefined;
  if (prev) {
    void prev.close().catch(() => {});
  }
}
