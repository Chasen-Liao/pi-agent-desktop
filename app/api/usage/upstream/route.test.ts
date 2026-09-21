import test from "node:test";
import assert from "node:assert/strict";
import { createUsageGetHandler } from "./route.ts";

function createTestHandler(onOptions?: (forceRefresh: boolean | undefined) => void) {
  return createUsageGetHandler({
    getProviderUsage: async (_providerId, options) => {
      onOptions?.(options?.forceRefresh);
      return null;
    },
    getAllUsage: async (options) => {
      onOptions?.(options?.forceRefresh);
      return [];
    },
  });
}

test("GET /api/usage/upstream returns data array", async () => {
  const req = new Request("http://localhost:30141/api/usage/upstream");
  const res = await createTestHandler()(req);

  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: unknown[] };
  assert.deepEqual(body.data, []);
  assert.ok(res.headers.get("x-request-id"));
});

test("GET /api/usage/upstream with unknown provider returns empty data array", async () => {
  const req = new Request("http://localhost:30141/api/usage/upstream?provider=non-existent-provider-12345");
  const res = await createTestHandler()(req);

  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: unknown[] };
  assert.deepEqual(body.data, []);
});

test("GET /api/usage/upstream supports refresh=1 and refresh=true flags", async () => {
  const refreshValues: Array<boolean | undefined> = [];
  const handler = createTestHandler((forceRefresh) => refreshValues.push(forceRefresh));

  const res1 = await handler(new Request("http://localhost:30141/api/usage/upstream?refresh=1"));
  assert.equal(res1.status, 200);

  const res2 = await handler(new Request("http://localhost:30141/api/usage/upstream?refresh=true"));
  assert.equal(res2.status, 200);
  assert.deepEqual(refreshValues, [true, true]);
});
