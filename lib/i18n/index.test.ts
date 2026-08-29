import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeLocale,
  normalizePreference,
  resolveLocale,
  translate,
} from "./index.ts";

test("normalizes supported browser locales", () => {
  assert.equal(normalizeLocale("zh-Hans-CN"), "zh-CN");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("fr-FR"), null);
});

test("normalizes stored preferences with a system fallback", () => {
  assert.equal(normalizePreference("zh-CN"), "zh-CN");
  assert.equal(normalizePreference("system"), "system");
  assert.equal(normalizePreference("invalid"), "system");
});

test("resolves system locale from the first supported browser language", () => {
  assert.equal(resolveLocale("system", ["fr-FR", "zh-Hans"]), "zh-CN");
  assert.equal(resolveLocale("system", ["fr-FR"]), "en");
  assert.equal(resolveLocale("en", ["zh-CN"]), "en");
});

test("translates and interpolates UI messages", () => {
  assert.equal(translate("zh-CN", "shell.openProject"), "打开项目");
  assert.equal(
    translate("zh-CN", "chat.retrying", { attempt: 2, max: 5 }),
    "正在重试（2/5）…",
  );
  assert.equal(
    translate("en", "sidebar.newSessionIn", { path: "/tmp/project" }),
    "New session in /tmp/project",
  );
  assert.equal(
    translate("zh-CN", "extension.addFailed"),
    "添加扩展或技能失败",
  );
});
