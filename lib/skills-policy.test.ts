import test from "node:test";
import assert from "node:assert/strict";
import { validateSkillsPackage } from "./skills-policy.ts";

// ---------- allowed ----------

test("validateSkillsPackage: allows owner/repo", () => {
  assert.equal(validateSkillsPackage("owner/repo"), null);
});

test("validateSkillsPackage: allows owner/repo@skill", () => {
  assert.equal(validateSkillsPackage("owner/repo@skill"), null);
});

test("validateSkillsPackage: allows owner/repo.sub (dot in segments)", () => {
  assert.equal(validateSkillsPackage("owner/repo.sub"), null);
});

test("validateSkillsPackage: allows owner-name/repo_name (dash and underscore)", () => {
  assert.equal(validateSkillsPackage("owner-name/repo_name"), null);
});

test("validateSkillsPackage: allows scoped-style with colon", () => {
  assert.equal(validateSkillsPackage("owner/repo:branch"), null);
});

// ---------- rejected: empty ----------

test("validateSkillsPackage: rejects empty string", () => {
  assert.equal(validateSkillsPackage(""), "package required");
});

test("validateSkillsPackage: rejects pure whitespace", () => {
  assert.equal(validateSkillsPackage("   "), "package required");
  assert.equal(validateSkillsPackage("\t\n"), "package required");
});

// ---------- rejected: missing slash ----------

test("validateSkillsPackage: rejects bare owner (no slash)", () => {
  assert.match(validateSkillsPackage("owner")!, /Invalid package identifier/);
});

test("validateSkillsPackage: rejects trailing slash (empty repo)", () => {
  assert.match(validateSkillsPackage("owner/")!, /Invalid package identifier/);
});

test("validateSkillsPackage: rejects leading slash (empty owner)", () => {
  assert.match(validateSkillsPackage("/repo")!, /Invalid package identifier/);
});

// ---------- rejected: shell metacharacters ----------

test("validateSkillsPackage: rejects command chaining with ';'", () => {
  assert.match(
    validateSkillsPackage("owner/repo;rm -rf /")!,
    /Invalid package identifier|forbidden characters/,
  );
});

test("validateSkillsPackage: rejects '&&' and whitespace injection", () => {
  assert.match(
    validateSkillsPackage("owner/repo && evil")!,
    /Invalid package identifier|forbidden characters/,
  );
});

test("validateSkillsPackage: rejects command substitution '$()'", () => {
  assert.match(
    validateSkillsPackage("owner/repo$(evil)")!,
    /Invalid package identifier|forbidden characters/,
  );
});

test("validateSkillsPackage: rejects backticks", () => {
  assert.match(
    validateSkillsPackage("owner/repo`evil`")!,
    /Invalid package identifier|forbidden characters/,
  );
});

// ---------- rejected: path traversal ----------

test("validateSkillsPackage: rejects '..' path traversal", () => {
  assert.match(
    validateSkillsPackage("../etc/passwd")!,
    /Invalid package identifier|\.\./,
  );
});

test("validateSkillsPackage: rejects embedded '..' in owner", () => {
  assert.match(
    validateSkillsPackage("../repo")!,
    /Invalid package identifier|\.\./,
  );
});

// ---------- rejected: newlines / other ----------

test("validateSkillsPackage: rejects newline injection", () => {
  assert.match(
    validateSkillsPackage("owner/repo\nnewline")!,
    /Invalid package identifier|forbidden characters/,
  );
});

test("validateSkillsPackage: rejects absolute Windows path", () => {
  assert.match(
    validateSkillsPackage("C:/evil")!,
    /Invalid package identifier/,
  );
});
