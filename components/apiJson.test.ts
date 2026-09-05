import assert from "node:assert/strict";
import test from "node:test";
import { apiJson } from "./apiJson.ts";

test("apiJson parses successful JSON responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ value: 1 }), { status: 200 });
  try {
    assert.deepEqual(
      await apiJson<{ value: number }>("/api/example", undefined, {
        fallback: "Request failed",
      }),
      { value: 1 },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("apiJson uses API error text and HTTP status for failed responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "denied" }), { status: 403 });
    await assert.rejects(
      apiJson("/api/example", undefined, { fallback: "Request failed" }),
      { message: "denied" },
    );

    globalThis.fetch = async () => new Response("not json", { status: 502 });
    await assert.rejects(
      apiJson("/api/example", undefined, { fallback: "Request failed" }),
      { message: "HTTP 502" },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("apiJson propagates Error from fetch verbatim and uses fallback only for non-Error rejections", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    await assert.rejects(
      apiJson("/api/example", undefined, { fallback: "Request failed" }),
      { message: "Failed to fetch" },
    );

    globalThis.fetch = () => Promise.reject("network-blip");
    await assert.rejects(
      apiJson("/api/example", undefined, { fallback: "Request failed" }),
      { message: "Request failed" },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
