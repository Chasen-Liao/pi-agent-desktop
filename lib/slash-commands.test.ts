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

test("/statusline is registered as a built-in command and is selectable from the menu", () => {
  const items = buildSlashCommandItems("", []);
  const statusline = items.find((item) => item.label === "/statusline");
  assert.ok(statusline, "/statusline should appear in the list");
  assert.equal(statusline.kind, "command");
  // Insertion text is a complete command, no trailing space — pressing Enter
  // sends it as-is, so the input must be intercepted client-side.
  assert.equal(statusline.insertText, "/statusline");
  assert.ok(!statusline.insertText.endsWith(" "));

  // Also filterable by partial query like `/stat`
  const filtered = buildSlashCommandItems("stat", []);
  assert.ok(filtered.some((item) => item.label === "/statusline"));
});
