import test from "node:test";
import assert from "node:assert/strict";
import { jaccardSimilarity, isNearDuplicate } from "./jaccard.ts";

test("identical multi-word strings score 1", () => {
  assert.equal(jaccardSimilarity("prefer dark mode theme", "prefer dark mode theme"), 1);
});

test("disjoint strings score 0", () => {
  assert.equal(jaccardSimilarity("alpha beta gamma", "delta epsilon zeta"), 0);
});

test("high overlap exceeds 0.7", () => {
  const s = jaccardSimilarity(
    "use path resolve for session root directory layout",
    "use path resolve for session root directory layout please"
  );
  assert.ok(s > 0.7);
});

test("identical single-char CJK scores 1 (no bigrams, falls back to equality)", () => {
  assert.equal(jaccardSimilarity("好", "好"), 1);
});

test("identical CJK strings score 1", () => {
  assert.equal(jaccardSimilarity("长期记忆用 SQLite 检索", "长期记忆用 SQLite 检索"), 1);
});

test("CJK near-duplicate exceeds the Dice 0.5 line", () => {
  const s = jaccardSimilarity(
    "长期记忆模块使用 SQLite 的 FTS5 做中文检索，需要 trigram 分词",
    "长期记忆用 SQLite FTS5 做中文检索，必须启用 trigram tokenizer 才支持中文"
  );
  assert.ok(s > 0.5);
});

test("unrelated CJK strings stay well below the threshold", () => {
  const s = jaccardSimilarity(
    "长期记忆模块使用 SQLite 的 FTS5 做中文检索",
    "用户喜欢在周报里用表格展示投放数据"
  );
  assert.ok(s < 0.5);
});

test("shared Latin tokens alone do not make CJK records duplicates (CR-2)", () => {
  const s = jaccardSimilarity("你好 SQLite", "您好 SQLite");
  assert.ok(s < 0.5, "distinct CJK must not reach the duplicate line on Latin overlap");
  assert.equal(isNearDuplicate("你好 SQLite", "您好 SQLite"), false);
});

test("short CJK plus a shared Latin token is not a duplicate (CR-2)", () => {
  assert.equal(isNearDuplicate("好 SQLite 检索", "差 SQLite 分析"), false);
});

test("Japanese revisions are scored without word spacing (CR-1)", () => {
  const s = jaccardSimilarity(
    "日本語のテキストを保存する長期記憶",
    "日本語の文章を保存する長期記憶機能"
  );
  assert.ok(s > 0.5);
  assert.equal(isNearDuplicate("日本語のテキストを保存する長期記憶", "日本語の文章を保存する長期記憶機能"), true);
});

test("Korean revisions are scored without word spacing (CR-1)", () => {
  const s = jaccardSimilarity("장기 기억 모듈 설정", "장기 기억 모듈 설정값");
  assert.ok(s > 0.5);
});
