import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { cacheSessionPath } from "../../../../lib/session-reader.ts";
import { POST as branchSession } from "./branch/route.ts";
import { POST as cloneSession } from "./clone/route.ts";
import { GET as exportSession } from "./export/route.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = mkdtempSync(join(tmpdir(), "pi-routes-agent-"));

before(() => {
  // SessionManager.forkFrom() uses the default agent directory when cloning.
  // Keep route tests out of the developer's real ~/.pi session store.
  process.env.PI_CODING_AGENT_DIR = testAgentDir;
});

after(() => {
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }
  rmSync(testAgentDir, { recursive: true, force: true });
});

function createTestSession(dir: string) {
  const sm = SessionManager.create(dir, dir);
  const userMsgId = sm.appendMessage({ role: "user", content: "Hello world" } as never);
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "Hello back" }] } as never);
  (sm as unknown as { _rewriteFile?: () => void })._rewriteFile?.();

  const file = sm.getSessionFile()!;
  const id = sm.getSessionId();
  cacheSessionPath(id, file);

  return { sm, file, id, userMsgId };
}

test("POST /api/sessions/[id]/branch returns 404 for non-existent session", async () => {
  const req = new Request("http://localhost/api/sessions/non-existent/branch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetEntryId: "entry-1" }),
  });
  const res = await branchSession(req, { params: Promise.resolve({ id: "non-existent" }) });
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error, "Session not found");
});

test("POST /api/sessions/[id]/branch returns 400 for invalid payload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-branch-test-"));
  try {
    const { id } = createTestSession(dir);
    const req = new Request(`http://localhost/api/sessions/${id}/branch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await branchSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("targetEntryId"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/sessions/[id]/branch returns 400 for missing targetEntryId in session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-branch-test-"));
  try {
    const { id } = createTestSession(dir);
    const req = new Request(`http://localhost/api/sessions/${id}/branch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetEntryId: "invalid-entry-id" }),
    });
    const res = await branchSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, "Target entry not found");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/sessions/[id]/branch creates branched session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-branch-test-"));
  try {
    const { id, userMsgId } = createTestSession(dir);
    const req = new Request(`http://localhost/api/sessions/${id}/branch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetEntryId: userMsgId, name: "Branched Session" }),
    });
    const res = await branchSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(typeof data.sessionId, "string");
    assert.equal(typeof data.sessionFile, "string");

    const branchedSm = SessionManager.open(data.sessionFile, dir);
    assert.equal(branchedSm.getSessionName(), "Branched Session");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/sessions/[id]/clone returns 404 for non-existent session", async () => {
  const req = new Request("http://localhost/api/sessions/non-existent/clone", {
    method: "POST",
  });
  const res = await cloneSession(req, { params: Promise.resolve({ id: "non-existent" }) });
  assert.equal(res.status, 404);
});

test("POST /api/sessions/[id]/clone creates cloned session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-clone-test-"));
  let clonedSessionFile: string | null = null;
  let clonedSessionFileIsolated = false;
  try {
    const { id } = createTestSession(dir);
    const req = new Request(`http://localhost/api/sessions/${id}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cloned Session" }),
    });
    const res = await cloneSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(typeof data.sessionId, "string");
    assert.equal(typeof data.sessionFile, "string");
    clonedSessionFile = data.sessionFile;
    clonedSessionFileIsolated = data.sessionFile.startsWith(`${testAgentDir}${sep}`);
    assert.ok(
      clonedSessionFileIsolated,
      `clone escaped isolated agent directory: ${data.sessionFile}`
    );

    const clonedSm = SessionManager.open(data.sessionFile, dir);
    assert.equal(clonedSm.getSessionName(), "Cloned Session");
  } finally {
    if (clonedSessionFile && clonedSessionFileIsolated) {
      rmSync(clonedSessionFile, { force: true });
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/sessions/[id]/export returns 404 for non-existent session", async () => {
  const req = new Request("http://localhost/api/sessions/non-existent/export?format=html");
  const res = await exportSession(req, { params: Promise.resolve({ id: "non-existent" }) });
  assert.equal(res.status, 404);
});

test("GET /api/sessions/[id]/export returns 400 for invalid format", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-export-test-"));
  try {
    const { id } = createTestSession(dir);
    const req = new Request(`http://localhost/api/sessions/${id}/export?format=invalid`);
    const res = await exportSession(req, { params: Promise.resolve({ id }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("Invalid export format"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/sessions/[id]/export exports HTML and Markdown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-export-test-"));
  try {
    const { id } = createTestSession(dir);

    // HTML export
    const reqHtml = new Request(`http://localhost/api/sessions/${id}/export?format=html`);
    const resHtml = await exportSession(reqHtml, { params: Promise.resolve({ id }) });
    assert.equal(resHtml.status, 200);
    assert.equal(resHtml.headers.get("content-type"), "text/html; charset=utf-8");
    const htmlBody = await resHtml.text();
    assert.ok(htmlBody.includes("<!DOCTYPE html>") || htmlBody.includes("<html"));

    // Markdown export with download header
    const reqMd = new Request(`http://localhost/api/sessions/${id}/export?format=markdown&download=true`);
    const resMd = await exportSession(reqMd, { params: Promise.resolve({ id }) });
    assert.equal(resMd.status, 200);
    assert.equal(resMd.headers.get("content-type"), "text/markdown; charset=utf-8");
    assert.equal(resMd.headers.get("content-disposition"), `attachment; filename="session-${id}.md"`);
    const mdBody = await resMd.text();
    assert.ok(mdBody.includes("## User"));
    assert.ok(mdBody.includes("Hello world"));
    assert.ok(mdBody.includes("## Assistant"));
    assert.ok(mdBody.includes("Hello back"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
