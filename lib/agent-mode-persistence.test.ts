import test from "node:test";
import assert from "node:assert/strict";
import {
  findLastAgentMode,
  createAgentModeCustomEntry,
  isValidAgentMode,
} from "./agent-mode-persistence.ts";
import type { SessionEntry } from "./types.ts";

test("isValidAgentMode validates modes correctly", () => {
  assert.equal(isValidAgentMode("plan"), true);
  assert.equal(isValidAgentMode("ask"), true);
  assert.equal(isValidAgentMode("full"), true);
  assert.equal(isValidAgentMode("other"), false);
  assert.equal(isValidAgentMode(null), false);
  assert.equal(isValidAgentMode(123), false);
});

test("findLastAgentMode returns undefined for empty or entries without mode", () => {
  assert.equal(findLastAgentMode([]), undefined);

  const entries: SessionEntry[] = [
    {
      type: "message",
      id: "e1",
      parentId: null,
      timestamp: "2026-07-28T00:00:00Z",
      message: { role: "user", content: "Hi" },
    },
  ];
  assert.equal(findLastAgentMode(entries), undefined);
});

test("findLastAgentMode scans entries from end to start for last valid mode", () => {
  const entries: SessionEntry[] = [
    {
      type: "custom",
      customType: "desktop_agent_mode",
      id: "e1",
      parentId: null,
      timestamp: "2026-07-28T00:00:00Z",
      data: { mode: "plan" },
    },
    {
      type: "message",
      id: "e2",
      parentId: "e1",
      timestamp: "2026-07-28T00:01:00Z",
      message: { role: "user", content: "Switch to full" },
    },
    {
      type: "custom",
      customType: "desktop_agent_mode",
      id: "e3",
      parentId: "e2",
      timestamp: "2026-07-28T00:02:00Z",
      data: { mode: "full" },
    },
  ];

  assert.equal(findLastAgentMode(entries), "full");
});

test("findLastAgentMode skips invalid modes and returns earlier valid mode", () => {
  const entries: SessionEntry[] = [
    {
      type: "custom",
      customType: "desktop_agent_mode",
      id: "e1",
      parentId: null,
      timestamp: "2026-07-28T00:00:00Z",
      data: { mode: "ask" },
    },
    {
      type: "custom",
      customType: "desktop_agent_mode",
      id: "e2",
      parentId: "e1",
      timestamp: "2026-07-28T00:01:00Z",
      data: { mode: "unknown_mode" },
    },
  ];

  assert.equal(findLastAgentMode(entries), "ask");
});

test("createAgentModeCustomEntry generates expected entry structure", () => {
  const entry = createAgentModeCustomEntry("plan", "parent-123");

  assert.equal(entry.type, "custom");
  assert.equal(entry.customType, "desktop_agent_mode");
  assert.equal(entry.parentId, "parent-123");
  assert.equal(typeof entry.id, "string");
  assert.ok(entry.id.length > 0);
  assert.equal(typeof entry.timestamp, "string");
  assert.deepEqual(entry.data, { mode: "plan" });
});

test("createAgentModeCustomEntry throws error on invalid mode", () => {
  assert.throws(
    () => {
      // @ts-expect-error testing runtime invalid input
      createAgentModeCustomEntry("invalid");
    },
    { message: /Invalid agent mode/ }
  );
});
