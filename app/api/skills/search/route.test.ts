import test from "node:test";
import assert from "node:assert/strict";
import { buildSkillUrl, buildSkillsSearchUrl, getAllowedSkillsApiBase } from "./skills-api-url.ts";

test("getAllowedSkillsApiBase defaults to skills.sh", () => {
  assert.equal(getAllowedSkillsApiBase(undefined, "production"), "https://skills.sh");
});

test("getAllowedSkillsApiBase rejects arbitrary production hosts", () => {
  assert.equal(getAllowedSkillsApiBase("https://example.com", "production"), "https://skills.sh");
  assert.equal(getAllowedSkillsApiBase("http://skills.sh", "production"), "https://skills.sh");
  assert.equal(getAllowedSkillsApiBase("https://skills.sh:8443", "production"), "https://skills.sh");
  assert.equal(getAllowedSkillsApiBase("https://127.0.0.1:4000", "production"), "https://skills.sh");
  assert.equal(getAllowedSkillsApiBase("http://127.0.0.1:4000", "production"), "https://skills.sh");
  assert.equal(getAllowedSkillsApiBase("http://192.168.1.10:4000", "production"), "https://skills.sh");
  assert.equal(getAllowedSkillsApiBase("file:///tmp/skills", "production"), "https://skills.sh");
});

test("getAllowedSkillsApiBase allows HTTPS localhost only outside production", () => {
  assert.equal(getAllowedSkillsApiBase("https://localhost:4000", "development"), "https://localhost:4000");
  assert.equal(getAllowedSkillsApiBase("https://127.0.0.1:4000", "test"), "https://127.0.0.1:4000");
  assert.equal(getAllowedSkillsApiBase("http://localhost:4000", "development"), "https://skills.sh");
  assert.equal(getAllowedSkillsApiBase("http://127.0.0.1:4000", "test"), "https://skills.sh");
  assert.equal(getAllowedSkillsApiBase("http://192.168.1.10:4000", "development"), "https://skills.sh");
});

test("buildSkillsSearchUrl encodes query and limit", () => {
  const url = buildSkillsSearchUrl("https://skills.sh", "a/b c", 7);
  assert.equal(url.toString(), "https://skills.sh/api/search?q=a%2Fb+c&limit=7");
});

test("buildSkillUrl keeps API slugs on the allowed base", () => {
  assert.equal(buildSkillUrl("https://skills.sh", "owner/repo"), "https://skills.sh/owner/repo");
  assert.equal(buildSkillUrl("https://skills.sh", "//evil.com/x"), "https://skills.sh/evil.com/x");
  assert.equal(buildSkillUrl("https://skills.sh", "https://evil.example/x"), "https://skills.sh/https%3A/evil.example/x");
});
