/**
 * Retry helper for agent APIs that may return 409 needsTrust.
 */
import type { NeedsTrustPayload } from "@/lib/trust-types";

export async function ensureTrustThenFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  promptTrust: (payload: NeedsTrustPayload) => Promise<string | null>
): Promise<Response> {
  // Avoid infinite loops if trust keep failing
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(input, init);
    if (res.status !== 409) return res;
    let body: NeedsTrustPayload;
    try {
      body = (await res.json()) as NeedsTrustPayload;
    } catch {
      return res;
    }
    if (!body?.needsTrust || !body.cwd) return res;
    const optionId = await promptTrust(body);
    if (!optionId) {
      // cancelled
      return new Response(JSON.stringify({ error: "Trust cancelled" }), {
        status: 499,
        headers: { "Content-Type": "application/json" },
      });
    }
    const trustRes = await fetch("/api/trust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: body.cwd, optionId }),
    });
    if (!trustRes.ok) {
      return trustRes;
    }
  }
  return fetch(input, init);
}
