import test from "node:test";
import assert from "node:assert/strict";
import {
  isLtmDisabledError,
  isMemoryType,
  parseForgetBody,
  parseLimit,
  parseRecallQuery,
  parseRememberBody,
  parseStatsQuery,
  LTM_DISABLED,
} from "./http.ts";

test("parseRecallQuery requires cwd and q", () => {
  const missing = parseRecallQuery("http://x/api/memory/recall");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /cwd/);

  const noQ = parseRecallQuery("http://x/api/memory/recall?cwd=/proj");
  assert.equal(noQ.ok, false);
  if (!noQ.ok) assert.match(noQ.error, /q/);

  const ok = parseRecallQuery(
    "http://x/api/memory/recall?cwd=%2Fproj&q=session+roots&limit=5"
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.cwd, "/proj");
    assert.equal(ok.value.query, "session roots");
    assert.equal(ok.value.limit, 5);
  }
});

test("parseRecallQuery accepts URLSearchParams", () => {
  const params = new URLSearchParams({ cwd: "D:\\work", q: "prefer path" });
  const ok = parseRecallQuery(params);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.cwd, "D:\\work");
    assert.equal(ok.value.query, "prefer path");
    assert.equal(ok.value.limit, undefined);
  }
});

test("parseRecallQuery rejects blank cwd/q", () => {
  const blank = parseRecallQuery("http://x/?cwd=%20&q=hi");
  assert.equal(blank.ok, false);
});

test("parseLimit clamps to 1..50", () => {
  assert.equal(parseLimit(undefined), 10);
  assert.equal(parseLimit("3"), 3);
  assert.equal(parseLimit(0), 1);
  assert.equal(parseLimit(100), 50);
  assert.equal(parseLimit("nope"), 10);
});

test("parseStatsQuery requires cwd", () => {
  assert.equal(parseStatsQuery("http://x/stats").ok, false);
  const ok = parseStatsQuery(new URL("http://x/stats?cwd=/a"));
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.cwd, "/a");
});

test("parseRememberBody validates fields", () => {
  assert.equal(parseRememberBody(null).ok, false);
  assert.equal(parseRememberBody({}).ok, false);
  assert.equal(parseRememberBody({ cwd: "/p" }).ok, false);

  const badType = parseRememberBody({
    cwd: "/p",
    content: "note",
    type: "unknown",
  });
  assert.equal(badType.ok, false);

  const badConcepts = parseRememberBody({
    cwd: "/p",
    content: "note",
    concepts: [1],
  });
  assert.equal(badConcepts.ok, false);

  const ok = parseRememberBody({
    cwd: "/p",
    content: "Prefer path resolve",
    type: "preference",
    concepts: ["path"],
    files: ["lib/a.ts"],
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.cwd, "/p");
    assert.equal(ok.value.type, "preference");
    assert.deepEqual(ok.value.concepts, ["path"]);
    assert.deepEqual(ok.value.files, ["lib/a.ts"]);
  }
});

test("parseForgetBody requires cwd and at least one id list", () => {
  assert.equal(parseForgetBody({ cwd: "/p" }).ok, false);
  assert.equal(
    parseForgetBody({ cwd: "/p", memoryIds: [], observationIds: [] }).ok,
    false
  );

  const ok = parseForgetBody({
    cwd: "/p",
    memoryIds: ["mem_1"],
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.value.memoryIds, ["mem_1"]);
  }

  const both = parseForgetBody({
    cwd: "/p",
    observationIds: ["obs_1"],
  });
  assert.equal(both.ok, true);
});

test("isMemoryType and isLtmDisabledError", () => {
  assert.equal(isMemoryType("fact"), true);
  assert.equal(isMemoryType("nope"), false);
  assert.equal(isLtmDisabledError(new Error(LTM_DISABLED)), true);
  assert.equal(isLtmDisabledError(new Error("other")), false);
  assert.equal(isLtmDisabledError("ltm_disabled"), false);
});
