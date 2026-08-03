import type {
  ForgetInput,
  MemoryType,
  ObserveInput,
  RecallHit,
  RecallInput,
  RememberInput,
} from "./types";

export interface MemoryBackend {
  remember(input: RememberInput): Promise<{ id: string; type: MemoryType }>;
  recall(input: RecallInput): Promise<RecallHit[]>;
  observe(
    input: ObserveInput
  ): Promise<{ observationId: string } | { deduplicated: true }>;
  forget(input: ForgetInput): Promise<{ deleted: number }>;
  health(): Promise<{ ok: boolean; backend: string; detail?: string }>;
  close?(): Promise<void>;
}
