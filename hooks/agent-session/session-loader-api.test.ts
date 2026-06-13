import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchSession, fetchContext } from "./session-loader-api.ts";

describe("session-loader-api", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: { url: string; options?: RequestInit }[] = [];
  let mockResponse: { status: number; ok: boolean; json: () => Promise<unknown> };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
    globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
      fetchCalls.push({ url: String(url), options });
      return mockResponse as unknown as Response;
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("fetchSession sends correct request and returns JSON data", async () => {
    const dummyData = { sessionId: "123", filePath: "path/to/session" };
    mockResponse = {
      status: 200,
      ok: true,
      json: async () => dummyData,
    };

    const result = await fetchSession("123", false);

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "/api/sessions/123");
    assert.deepEqual(result, dummyData);
  });

  test("fetchSession formats URL correctly when includeState is true", async () => {
    mockResponse = {
      status: 200,
      ok: true,
      json: async () => ({}),
    };

    await fetchSession("foo/bar", true);

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "/api/sessions/foo%2Fbar?includeState");
  });

  test("fetchSession returns null on 404 response", async () => {
    mockResponse = {
      status: 404,
      ok: false,
      json: async () => ({}),
    };

    const result = await fetchSession("123");
    assert.equal(result, null);
  });

  test("fetchSession throws error on non-ok non-404 response", async () => {
    mockResponse = {
      status: 500,
      ok: false,
      json: async () => ({}),
    };

    await assert.rejects(
      async () => {
        await fetchSession("123");
      },
      /HTTP 500/
    );
  });

  test("fetchContext sends correct request without leafId", async () => {
    const dummyContext = { context: { messages: [], entryIds: [] } };
    mockResponse = {
      status: 200,
      ok: true,
      json: async () => dummyContext,
    };

    const result = await fetchContext("123", null);

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "/api/sessions/123/context");
    assert.deepEqual(result, dummyContext);
  });

  test("fetchContext sends correct request with leafId", async () => {
    const dummyContext = { context: { messages: [], entryIds: [] } };
    mockResponse = {
      status: 200,
      ok: true,
      json: async () => dummyContext,
    };

    const result = await fetchContext("123", "leaf-abc");

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "/api/sessions/123/context?leafId=leaf-abc");
    assert.deepEqual(result, dummyContext);
  });

  test("fetchContext throws error on non-ok response", async () => {
    mockResponse = {
      status: 400,
      ok: false,
      json: async () => ({}),
    };

    await assert.rejects(
      async () => {
        await fetchContext("123", null);
      },
      /HTTP 400/
    );
  });
});
