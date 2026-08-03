import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { MemoryBackend } from "./backend.ts";
import { AgentMemoryRestBackend } from "./agentmemory-backend.ts";
import { getLtmConfig, type LtmConfig } from "./config.ts";
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

export type RememberFromCwdInput = Omit<RememberInput, "projectId">;
export type RecallFromCwdInput = Omit<RecallInput, "projectId">;
export type ObserveFromCwdInput = Omit<ObserveInput, "projectId">;
export type ForgetFromCwdInput = Omit<ForgetInput, "projectId">;

type LtmServiceGlobal = {
  __piLtmService?: MemoryService;
  __piLtmServiceKey?: string;
};

function ltmGlobal(): LtmServiceGlobal {
  return globalThis as typeof globalThis & LtmServiceGlobal;
}

function createBackend(config: LtmConfig): MemoryBackend {
  if (config.backend === "agentmemory") {
    return new AgentMemoryRestBackend(config.agentmemoryUrl);
  }
  return new SqliteBackend(config.dbPath);
}

function serviceKey(config: LtmConfig): string {
  return `${config.backend}|${config.dbPath}|${config.enabled}`;
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
    throw new Error("stats not supported for this backend");
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
 * Keyed by backend|dbPath|enabled so config changes get a fresh instance.
 */
export function getMemoryService(agentDir?: string): MemoryService {
  const dir = agentDir ?? getAgentDir();
  const config = getLtmConfig(dir);
  const key = serviceKey(config);
  const g = ltmGlobal();

  if (g.__piLtmService && g.__piLtmServiceKey === key) {
    return g.__piLtmService;
  }

  const previous = g.__piLtmService;
  const next = MemoryService.create(config);
  g.__piLtmService = next;
  g.__piLtmServiceKey = key;

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
  if (prev) {
    void prev.close().catch(() => {});
  }
}
