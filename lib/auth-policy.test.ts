import test from "node:test";
import assert from "node:assert/strict";
import { validateProviderName } from "./auth-policy.ts";

test("validateProviderName: allows typical provider slugs", () => {
  for (const p of ["anthropic", "openai", "google", "openrouter"]) {
    assert.equal(validateProviderName(p), null, `${p} should be allowed`);
  }
});

test("validateProviderName: allows hyphens after first letter", () => {
  assert.equal(validateProviderName("provider-1"), null);
  assert.equal(validateProviderName("a-b-c"), null);
});

test("validateProviderName: rejects empty string", () => {
  assert.match(validateProviderName("")!, /required/);
});

test("validateProviderName: rejects path traversal attempts", () => {
  assert.match(validateProviderName("../etc")!, /Invalid provider name/);
  assert.match(validateProviderName("..")!, /Invalid provider name/);
  assert.match(validateProviderName("/")!, /Invalid provider name/);
  assert.match(validateProviderName("\\")!, /Invalid provider name/);
});

test("validateProviderName: rejects uppercase", () => {
  assert.match(validateProviderName("ANTHROPIC")!, /Invalid provider name/);
  assert.match(validateProviderName("Anthropic")!, /Invalid provider name/);
});

test("validateProviderName: rejects leading hyphen", () => {
  assert.match(validateProviderName("-foo")!, /Invalid provider name/);
});

test("validateProviderName: rejects leading digit", () => {
  assert.match(validateProviderName("1foo")!, /Invalid provider name/);
});

test("validateProviderName: rejects internal whitespace", () => {
  assert.match(validateProviderName("foo bar")!, /Invalid provider name/);
});

test("validateProviderName: rejects shell metacharacters", () => {
  assert.match(validateProviderName("foo;rm -rf")!, /Invalid provider name/);
  assert.match(validateProviderName("foo|cat")!, /Invalid provider name/);
  assert.match(validateProviderName("foo&bar")!, /Invalid provider name/);
  assert.match(validateProviderName("foo`whoami`")!, /Invalid provider name/);
});

test("validateProviderName: rejects names exceeding 64 chars", () => {
  const tooLong = "a".repeat(65);
  assert.match(validateProviderName(tooLong)!, /too long/);
});

test("validateProviderName: allows exactly 64 chars", () => {
  const exact = "a".repeat(64);
  assert.equal(validateProviderName(exact), null);
});
