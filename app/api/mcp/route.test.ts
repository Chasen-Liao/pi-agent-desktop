import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GET, POST, DELETE } from "./route.ts";
import { POST as toggleMcp } from "./toggle/route.ts";
import { POST as testMcp } from "./test/route.ts";

test("GET /api/mcp lists merged servers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-api-test-"));
  try {
    const req = new Request(`http://localhost/api/mcp?cwd=${encodeURIComponent(dir)}`);
    const res = await GET(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.servers));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/mcp validates inputs and saves server", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-api-test-"));
  try {
    const invalidReq = new Request("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({ server: { id: "test-server" } }),
    });
    const invalidRes = await POST(invalidReq);
    assert.equal(invalidRes.status, 400);

    const req = new Request("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        scope: "project",
        cwd: dir,
        server: {
          id: "my-mcp",
          command: "node",
          args: ["-v"],
        },
      }),
    });
    const res = await POST(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.server.id, "my-mcp");
    assert.equal(body.server.scope, "project");

    const getReq = new Request(`http://localhost/api/mcp?cwd=${encodeURIComponent(dir)}`);
    const getRes = await GET(getReq);
    const getBody = await getRes.json();
    const found = getBody.servers.find((s: { id: string }) => s.id === "my-mcp");
    assert.ok(found);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/mcp/toggle updates server disabled state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-api-test-"));
  try {
    const saveReq = new Request("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        scope: "project",
        cwd: dir,
        server: { id: "toggle-server", command: "echo" },
      }),
    });
    await POST(saveReq);

    const toggleReq = new Request("http://localhost/api/mcp/toggle", {
      method: "POST",
      body: JSON.stringify({
        scope: "project",
        cwd: dir,
        id: "toggle-server",
        disabled: true,
      }),
    });
    const toggleRes = await toggleMcp(toggleReq);
    assert.equal(toggleRes.status, 200);
    const toggleBody = await toggleRes.json();
    assert.equal(toggleBody.success, true);

    const getReq = new Request(`http://localhost/api/mcp?cwd=${encodeURIComponent(dir)}`);
    const getRes = await GET(getReq);
    const getBody = await getRes.json();
    const found = getBody.servers.find((s: { id: string }) => s.id === "toggle-server");
    assert.equal(found.disabled, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("DELETE /api/mcp removes server config", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-api-test-"));
  try {
    const saveReq = new Request("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({
        scope: "project",
        cwd: dir,
        server: { id: "delete-me", command: "node" },
      }),
    });
    await POST(saveReq);

    const deleteReq = new Request("http://localhost/api/mcp", {
      method: "DELETE",
      body: JSON.stringify({ scope: "project", cwd: dir, id: "delete-me" }),
    });
    const deleteRes = await DELETE(deleteReq);
    assert.equal(deleteRes.status, 200);
    const deleteBody = await deleteRes.json();
    assert.equal(deleteBody.success, true);

    const notFoundReq = new Request("http://localhost/api/mcp", {
      method: "DELETE",
      body: JSON.stringify({ scope: "project", cwd: dir, id: "non-existent" }),
    });
    const notFoundRes = await DELETE(notFoundReq);
    assert.equal(notFoundRes.status, 404);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/mcp/test tests server execution", async () => {
  const testReq = new Request("http://localhost/api/mcp/test", {
    method: "POST",
    body: JSON.stringify({ command: "node", args: ["-v"] }),
  });
  const res = await testMcp(testReq);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.success, "boolean");
});
