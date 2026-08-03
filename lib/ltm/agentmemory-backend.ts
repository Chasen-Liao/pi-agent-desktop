import type { MemoryBackend } from "./backend.ts";
import type {
  ForgetInput,
  MemoryType,
  ObserveInput,
  RecallHit,
  RecallInput,
  RememberInput,
} from "./types.ts";

const NOT_IMPLEMENTED = "agentmemory backend not implemented in v1";

/**
 * Phase-1 stub for a future agentmemory REST adapter.
 * health reports not_implemented; all other methods throw.
 */
export class AgentMemoryRestBackend implements MemoryBackend {
  private readonly _url: string;

  constructor(url: string = "http://127.0.0.1:3111") {
    this._url = url;
  }

  get url(): string {
    return this._url;
  }

  async remember(
    _input: RememberInput
  ): Promise<{ id: string; type: MemoryType }> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async recall(_input: RecallInput): Promise<RecallHit[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async observe(
    _input: ObserveInput
  ): Promise<{ observationId: string } | { deduplicated: true }> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async forget(_input: ForgetInput): Promise<{ deleted: number }> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async health(): Promise<{ ok: boolean; backend: string; detail?: string }> {
    return {
      ok: false,
      backend: "agentmemory",
      detail: "not_implemented",
    };
  }
}
