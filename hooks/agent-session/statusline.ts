import type { StatuslineResponse } from "@/lib/types";

/**
 * Workspace status line helpers.
 *
 * Kept out of the hook so the behaviour can be tested directly instead of by
 * matching the hook's source text.
 */

/**
 * Fetch the status line snapshot for a workspace.
 *
 * Throws when the route rejects the request (for example a cwd outside the
 * allowed roots) so the caller can surface the reason instead of rendering an
 * empty status line.
 */
export async function fetchStatusline(cwd: string): Promise<StatuslineResponse> {
  const res = await fetch(`/api/statusline?cwd=${encodeURIComponent(cwd)}`);
  const body = (await res.json()) as StatuslineResponse & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body;
}

/**
 * Symbol-only summary of the workspace status line.
 *
 * Deliberately free of prose: it renders into the chat transcript and the
 * hook layer has no i18n context, so only symbols, numbers and git's own
 * text (branch name, commit subject) are used.
 */
export function formatStatusline(d: StatuslineResponse): string {
  if (!d.isRepo) {
    return d.error ? `— ${d.error}` : "—";
  }
  const lines: string[] = [`\`${d.branch ?? "—"}\``];
  const counts: string[] = [];
  if (d.ahead) counts.push(`↑${d.ahead}`);
  if (d.behind) counts.push(`↓${d.behind}`);
  if (d.staged) counts.push(`+${d.staged}`);
  if (d.modified) counts.push(`~${d.modified}`);
  if (d.untracked) counts.push(`?${d.untracked}`);
  if (d.deleted) counts.push(`−${d.deleted}`);
  if (counts.length > 0) lines.push(counts.join(" "));
  if (d.lastCommit) {
    lines.push(`\`${d.lastCommit.hash.slice(0, 7)}\` ${d.lastCommit.subject}`);
  }
  return lines.join("\n");
}
