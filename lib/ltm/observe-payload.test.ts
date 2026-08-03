import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAgentEndObservation,
  buildPreCompactObservation,
} from "./observe-payload.ts";

test("buildAgentEndObservation uses first line of user as title (≤80)", () => {
  const user = "fix login bug\nmore detail here";
  const { title, narrative } = buildAgentEndObservation({
    userText: user,
    assistantText: "patched auth",
  });
  assert.equal(title, "fix login bug");
  // Narrative keeps full (truncated) user text, not only the first line.
  assert.equal(
    narrative,
    "User: fix login bug\nmore detail here\nAssistant: patched auth"
  );
});

test("buildAgentEndObservation truncates title to 80 chars", () => {
  const user = "x".repeat(100);
  const { title } = buildAgentEndObservation({
    userText: user,
    assistantText: "ok",
  });
  assert.equal(title.length, 80);
  assert.equal(title, "x".repeat(80));
});

test("buildAgentEndObservation truncates user 500 and assistant 4000", () => {
  const userText = "u".repeat(600);
  const assistantText = "a".repeat(5000);
  const { narrative } = buildAgentEndObservation({ userText, assistantText });
  const userPart = narrative.match(/^User: (.*)\nAssistant: /s)?.[1] ?? "";
  const asstPart = narrative.match(/\nAssistant: (.*)$/s)?.[1] ?? "";
  assert.equal(userPart.length, 500);
  assert.equal(asstPart.length, 4000);
  assert.equal(userPart, "u".repeat(500));
  assert.equal(asstPart, "a".repeat(4000));
});

test("buildAgentEndObservation empty strings become (empty)", () => {
  const { title, narrative } = buildAgentEndObservation({
    userText: "",
    assistantText: "",
  });
  assert.equal(title, "(empty)");
  assert.equal(narrative, "User: (empty)\nAssistant: (empty)");
});

test("buildPreCompactObservation title from first line ≤80", () => {
  const messagesText = "session summary line\nrest of messages";
  const { title, narrative } = buildPreCompactObservation({ messagesText });
  assert.equal(title, "session summary line");
  assert.equal(narrative, messagesText);
});

test("buildPreCompactObservation truncates body to 6000", () => {
  const messagesText = "m".repeat(7000);
  const { title, narrative } = buildPreCompactObservation({ messagesText });
  assert.equal(narrative.length, 6000);
  assert.equal(narrative, "m".repeat(6000));
  assert.equal(title.length, 80);
});

test("buildPreCompactObservation empty becomes (empty)", () => {
  const { title, narrative } = buildPreCompactObservation({ messagesText: "" });
  assert.equal(title, "(empty)");
  assert.equal(narrative, "(empty)");
});
