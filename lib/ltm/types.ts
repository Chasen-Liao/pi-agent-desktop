export type MemoryType =
  | "pattern"
  | "preference"
  | "architecture"
  | "bug"
  | "workflow"
  | "fact";

export type ObserveKind = "agent_end" | "pre_compact";

export interface RememberInput {
  projectId: string;
  content: string;
  type?: MemoryType;
  concepts?: string[];
  files?: string[];
  sourceObservationIds?: string[];
  sessionId?: string;
}

export interface RecallInput {
  projectId: string;
  query: string;
  limit?: number; // default 10, max 50
  kinds?: Array<"memory" | "observation">; // default both
}

export interface ObserveInput {
  projectId: string;
  sessionId: string;
  kind: ObserveKind;
  title: string;
  narrative: string;
  source?: unknown;
}

export interface ForgetInput {
  projectId: string;
  memoryIds?: string[];
  observationIds?: string[];
}

export interface RecallHit {
  kind: "memory" | "observation";
  id: string;
  title: string;
  snippet: string;
  score?: number;
  type?: MemoryType | ObserveKind;
  createdAt: string;
}
