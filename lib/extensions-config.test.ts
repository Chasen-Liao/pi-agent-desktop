import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getExtensionIdAndName, getExtensionsConfig, mutateExtensionOrSkill } from "./extensions-config.ts";

test("getExtensionIdAndName handles directory and file paths", () => {
  assert.deepEqual(getExtensionIdAndName("C:/users/test/.pi/agent/extensions/my-tool/index.ts"), {
    id: "my-tool",
    name: "my-tool",
  });
  assert.deepEqual(getExtensionIdAndName("/var/pi/extensions/single-file.ts"), {
    id: "single-file",
    name: "single-file",
  });
});

test("getExtensionsConfig lists installed extensions, skills, and diagnostics", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-ext-test-"));
  const agentDir = join(dir, "agent");
  const projectDir = join(dir, "project");

  try {
    // Create global extension folder & index.ts
    const extDir = join(agentDir, "extensions", "sample-ext");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "index.ts"), "// extension code\nexport default function() {}\n");

    // Create project skill folder & SKILL.md
    const skillDir = join(projectDir, ".agents", "skills", "my-project-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: my-project-skill\ndescription: Test skill for project\n---\n# My Skill\n"
    );

    const result = await getExtensionsConfig(projectDir, { agentDir });

    assert.ok(Array.isArray(result.extensions));
    assert.ok(Array.isArray(result.skills));
    assert.ok(Array.isArray(result.diagnostics));

    // Verify global extension discovery
    const ext = result.extensions.find((e) => e.id === "sample-ext");
    assert.ok(ext);
    assert.equal(ext?.scope, "global");
    assert.equal(ext?.enabled, true);

    // Verify project skill discovery
    const skill = result.skills.find((s) => s.name === "my-project-skill");
    assert.ok(skill);
    assert.equal(skill?.description, "Test skill for project");
    assert.equal(skill?.scope, "project");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("mutateExtensionOrSkill: rejects toggle for arbitrary file path outside skill dirs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-ext-test-"));
  const arbitraryFile = join(dir, "arbitrary.txt");
  writeFileSync(arbitraryFile, "content", "utf8");

  try {
    await assert.rejects(
      async () => {
        await mutateExtensionOrSkill({
          action: "toggle",
          type: "skill",
          nameOrPath: arbitraryFile,
          scope: "global",
          cwd: dir,
        });
      },
      /Skill target outside allowed skill directories/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
