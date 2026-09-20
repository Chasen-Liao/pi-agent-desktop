import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "./route.ts";

test("GET /api/usage/upstream returns data array", async () => {
  const req = new Request("http://localhost:30141/api/usage/upstream");
  const res = await GET(req);

  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: unknown[] };
  assert.ok(Array.isArray(body.data));
  assert.ok(res.headers.get("x-request-id"));
});

test("GET /api/usage/upstream with unknown provider returns empty data array", async () => {
  const req = new Request("http://localhost:30141/api/usage/upstream?provider=non-existent-provider-12345");
  const res = await GET(req);

  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: unknown[] };
  assert.deepEqual(body.data, []);
});

test("GET /api/usage/upstream supports refresh=1 and refresh=true flags", async () => {
  const req1 = new Request("http://localhost:30141/api/usage/upstream?refresh=1");
  const res1 = await GET(req1);
  assert.equal(res1.status, 200);

  const req2 = new Request("http://localhost:30141/api/usage/upstream?refresh=true");
  const res2 = await GET(req2);
  assert.equal(res2.status, 200);
});
