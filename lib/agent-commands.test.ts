import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_COMMAND_TYPES,
  validateAgentCommand,
} from "./agent-commands.ts";

test("AGENT_COMMAND_TYPES covers all 15 send() cases", () => {
  // Must stay in sync with the switch in lib/rpc-manager.ts. If either side
  // adds/removes a case, this test forces an explicit update here too.
  assert.equal(AGENT_COMMAND_TYPES.size, 15);
  for (const t of [
    "prompt",
    "abort",
    "get_state",
    "set_model",
    "fork",
    "navigate_tree",
    "set_thinking_level",
    "compact",
    "set_auto_compaction",
    "steer",
    "follow_up",
    "get_tools",
    "set_tools",
    "abort_compaction",
    "set_auto_retry",
  ]) {
    assert.ok(AGENT_COMMAND_TYPES.has(t as never), `missing ${t}`);
  }
});

test("every whitelisted type passes validation", () => {
  for (const t of AGENT_COMMAND_TYPES) {
    assert.equal(validateAgentCommand({ type: t }), null);
  }
});

test("null body is rejected", () => {
  assert.match(validateAgentCommand(null)!, /must be an object/);
});

test("string body is rejected", () => {
  assert.match(validateAgentCommand("prompt")!, /must be an object/);
});

test("number body is rejected", () => {
  assert.match(validateAgentCommand(42)!, /must be an object/);
});

test("array body is rejected (needs a `type` field)", () => {
  // Arrays are typeof "object" but have no `type` string field.
  assert.match(validateAgentCommand([])!, /type must be a string/);
});

test("empty object is rejected (missing type)", () => {
  assert.match(validateAgentCommand({})!, /type must be a string/);
});

test("non-string type is rejected", () => {
  assert.match(validateAgentCommand({ type: 1 })!, /type must be a string/);
});

test("unknown command type is rejected", () => {
  const err = validateAgentCommand({ type: "unknown_cmd" })!;
  assert.match(err, /Unknown command type/);
  assert.match(err, /unknown_cmd/);
});

test("prompt with message is allowed (extra fields ignored)", () => {
  assert.equal(
    validateAgentCommand({ type: "prompt", message: "hello" }),
    null
  );
});

test("fork with parentId is allowed (extra fields ignored)", () => {
  assert.equal(
    validateAgentCommand({ type: "fork", parentId: "abc" }),
    null
  );
});

test("error message echoes the offending type for triage", () => {
  // Useful when scanning logs — the bad value is visible without re-reading the body.
  const err = validateAgentCommand({ type: "DROP TABLE" })!;
  assert.ok(err.includes("DROP TABLE"));
});
