import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GET, POST } from "./route.ts";

test("GET /api/extensions lists extensions, skills, and diagnostics", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-ext-api-test-"));
  try {
    const req = new Request(`http://localhost/api/extensions?cwd=${encodeURIComponent(dir)}`);
    const res = await GET(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.extensions));
    assert.ok(Array.isArray(body.skills));
    assert.ok(Array.isArray(body.diagnostics));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/extensions validates input parameters", async () => {
  const invalidReq = new Request("http://localhost/api/extensions", {
    method: "POST",
    body: JSON.stringify({ action: "unknown", type: "extension", nameOrPath: "ext", scope: "global" }),
  });
  const res = await POST(invalidReq);
  assert.equal(res.status, 400);
});

test("POST /api/extensions adds and removes extension / skill in settings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-ext-api-test-"));
  try {
    const addExtReq = new Request("http://localhost/api/extensions", {
      method: "POST",
      body: JSON.stringify({
        action: "add",
        type: "extension",
        nameOrPath: "my-custom-ext",
        scope: "project",
        cwd: dir,
      }),
    });
    const addExtRes = await POST(addExtReq);
    assert.equal(addExtRes.status, 200);
    assert.equal((await addExtRes.json()).success, true);

    const settingsPath = join(dir, ".pi", "settings.json");
    const settingsContent = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.ok(settingsContent.extensions.includes("my-custom-ext"));

    const remExtReq = new Request("http://localhost/api/extensions", {
      method: "POST",
      body: JSON.stringify({
        action: "remove",
        type: "extension",
        nameOrPath: "my-custom-ext",
        scope: "project",
        cwd: dir,
      }),
    });
    const remExtRes = await POST(remExtReq);
    assert.equal(remExtRes.status, 200);
    assert.equal((await remExtRes.json()).success, true);

    const updatedSettings = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.equal(updatedSettings.extensions.includes("my-custom-ext"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/extensions toggles skill disable-model-invocation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-ext-api-test-"));
  try {
    const skillDir = join(dir, ".agents", "skills", "test-skill");
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, "SKILL.md");
    writeFileSync(skillPath, "---\nname: test-skill\ndescription: test\n---\n# Skill Content\n");

    const toggleReq = new Request("http://localhost/api/extensions", {
      method: "POST",
      body: JSON.stringify({
        action: "toggle",
        type: "skill",
        nameOrPath: skillPath,
        scope: "project",
        cwd: dir,
        enabled: false,
      }),
    });
    const toggleRes = await POST(toggleReq);
    assert.equal(toggleRes.status, 200);
    assert.equal((await toggleRes.json()).success, true);

    const content = readFileSync(skillPath, "utf8");
    assert.ok(content.includes("disable-model-invocation: true"));

    const enableReq = new Request("http://localhost/api/extensions", {
      method: "POST",
      body: JSON.stringify({
        action: "toggle",
        type: "skill",
        nameOrPath: skillPath,
        scope: "project",
        cwd: dir,
        enabled: true,
      }),
    });
    const enableRes = await POST(enableReq);
    assert.equal(enableRes.status, 200);

    const reenabledContent = readFileSync(skillPath, "utf8");
    assert.equal(reenabledContent.includes("disable-model-invocation"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
