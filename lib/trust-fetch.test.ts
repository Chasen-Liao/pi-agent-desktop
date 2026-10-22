import test from "node:test";
import assert from "node:assert/strict";
import { ensureTrustThenFetch } from "./trust-fetch.ts";

/**
 * Behavioural coverage for the 409 needsTrust handshake helper.
 *
 * This is a security boundary: if the retry loop misbehaves, the trust gate
 * silently stops working while every other test still passes. The cases below
 * pin the loop bound, the cancel path, and every passthrough branch.
 */

type FetchCall = { input: unknown; init: RequestInit | undefined };

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const NEEDS_TRUST = {
  needsTrust: true,
  cwd: "/tmp/proj",
  options: [{ id: "trust", label: "Trust", trusted: true, persist: true }],
};

/**
 * Run `fn` with globalThis.fetch replaced by `handler`, and return the calls
 * that were made so the test can assert on the request sequence.
 */
async function withStubbedFetch(
  handler: (call: FetchCall, index: number) => Response | Promise<Response>,
  fn: (calls: FetchCall[]) => Promise<void>
): Promise<FetchCall[]> {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    return handler({ input, init }, calls.length - 1);
  }) as unknown as typeof globalThis.fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
  return calls;
}

test("a non-409 response is returned untouched", async () => {
  await withStubbedFetch(
    () => jsonResponse({ ok: true }, 200),
    async (calls) => {
      const res = await ensureTrustThenFetch("/api/agent/x", { method: "POST" }, async () => "trust");
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
      assert.equal(calls.length, 1);
    }
  );
});

test("cancelling the trust prompt returns 499 without posting to /api/trust", async () => {
  await withStubbedFetch(
    () => jsonResponse(NEEDS_TRUST, 409),
    async (calls) => {
      const res = await ensureTrustThenFetch("/api/agent/x", undefined, async () => null);
      assert.equal(res.status, 499);
      assert.deepEqual(await res.json(), { error: "Trust cancelled" });
      // The original request is not retried after a cancel.
      assert.equal(calls.length, 1);
    }
  );
});

test("trusting posts the decision to /api/trust and retries the original request", async () => {
  await withStubbedFetch(
    (call, index) => {
      if (index === 0) return jsonResponse(NEEDS_TRUST, 409);
      if (String(call.input).includes("/api/trust")) return jsonResponse({ success: true }, 200);
      return jsonResponse({ ok: true }, 200);
    },
    async (calls) => {
      const res = await ensureTrustThenFetch("/api/agent/x", undefined, async () => "trust");
      assert.equal(res.status, 200);

      assert.equal(calls.length, 3);
      assert.equal(calls[1].input, "/api/trust");
      assert.equal(calls[1].init?.method, "POST");

      const body = JSON.parse(String(calls[1].init?.body)) as { cwd: string; optionId: string };
      assert.equal(body.cwd, NEEDS_TRUST.cwd);
      assert.equal(body.optionId, "trust");
    }
  );
});

test("a rejected /api/trust decision is returned to the caller", async () => {
  await withStubbedFetch(
    (_call, index) => {
      if (index === 0) return jsonResponse(NEEDS_TRUST, 409);
      return jsonResponse({ error: "denied" }, 500);
    },
    async (calls) => {
      const res = await ensureTrustThenFetch("/api/agent/x", undefined, async () => "trust");
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { error: "denied" });
      // No retry after the trust POST failed.
      assert.equal(calls.length, 2);
    }
  );
});

test("the retry loop is bounded at four attempts", async () => {
  let prompts = 0;
  await withStubbedFetch(
    (call) => {
      // Only the original request keeps asking for trust; the decision POST
      // succeeds, so the loop runs to its bound.
      if (String(call.input).includes("/api/trust")) return jsonResponse({ success: true }, 200);
      return jsonResponse(NEEDS_TRUST, 409);
    },
    async (calls) => {
      const res = await ensureTrustThenFetch("/api/agent/x", undefined, async () => {
        prompts += 1;
        return "trust";
      });

      // After the loop is exhausted the helper makes one final, unguarded call.
      assert.equal(res.status, 409);
      assert.equal(prompts, 4, "trust prompt must not be shown more than four times");
      assert.equal(calls.length, 9, "4 original + 4 trust POSTs + 1 final attempt");
    }
  );
});

test("a 409 without a needsTrust payload is returned untouched", async () => {
  await withStubbedFetch(
    () => jsonResponse({ error: "something else" }, 409),
    async (calls) => {
      const res = await ensureTrustThenFetch("/api/agent/x", undefined, async () => "trust");
      assert.equal(res.status, 409);
      assert.equal(calls.length, 1);
    }
  );
});

test("a 409 with an unparsable body is returned untouched", async () => {
  await withStubbedFetch(
    () => new Response("not json", { status: 409 }),
    async (calls) => {
      const res = await ensureTrustThenFetch("/api/agent/x", undefined, async () => "trust");
      assert.equal(res.status, 409);
      assert.equal(calls.length, 1);
    }
  );
});
