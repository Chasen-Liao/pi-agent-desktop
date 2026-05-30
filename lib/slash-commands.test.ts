import assert from "node:assert/strict";
import test from "node:test";
import { buildSlashCommandItems, getSlashTriggerQuery } from "./slash-commands.ts";

test("slash command trigger only starts at the beginning of the draft", () => {
  assert.equal(getSlashTriggerQuery("/", 1), "");
  assert.equal(getSlashTriggerQuery("/ski", 4), "ski");
  assert.equal(getSlashTriggerQuery("hello /", 7), null);
  assert.equal(getSlashTriggerQuery(" /", 2), null);
  assert.equal(getSlashTriggerQuery("/compact now", 12), null);
});

test("slash command items include built-ins and enabled skills", () => {
  const items = buildSlashCommandItems("skill", [
    {
      name: "frontend-design",
      description: "Create distinctive frontend interfaces",
      disableModelInvocation: false,
      sourceInfo: { scope: "global" },
    },
    {
      name: "hidden-skill",
      description: "Should not appear",
      disableModelInvocation: true,
      sourceInfo: { scope: "project" },
    },
  ]);

  assert.ok(items.some((item) => item.label === "/skills" && item.kind === "command"));
  assert.ok(items.some((item) => item.label === "/frontend-design" && item.kind === "skill"));
  assert.ok(!items.some((item) => item.label === "/hidden-skill"));
});
