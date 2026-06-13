import type { SessionData } from "./use-session-loader";
import type { AgentMessage } from "@/lib/types";

export async function fetchSession(sid: string, includeState = false): Promise<SessionData | null> {
  const url = includeState
    ? `/api/sessions/${encodeURIComponent(sid)}?includeState`
    : `/api/sessions/${encodeURIComponent(sid)}`;
  const res = await fetch(url);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json() as Promise<SessionData>;
}

export async function fetchContext(sid: string, leafId: string | null): Promise<{ context: { messages: AgentMessage[]; entryIds: string[] } }> {
  const url = leafId
    ? `/api/sessions/${encodeURIComponent(sid)}/context?leafId=${encodeURIComponent(leafId)}`
    : `/api/sessions/${encodeURIComponent(sid)}/context`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json() as Promise<{ context: { messages: AgentMessage[]; entryIds: string[] } }>;
}
