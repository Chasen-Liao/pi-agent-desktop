import test from "node:test";
import assert from "node:assert/strict";
import { jaccardSimilarity } from "./jaccard.ts";

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
