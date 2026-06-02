import assert from "node:assert/strict";
import test from "node:test";
import { addRunningTool, removeRunningTool } from "./agent-phase.ts";

test("addRunningTool starts running_tools phase", () => {
  assert.deepEqual(addRunningTool(null, "tool-1", "read"), {
    kind: "running_tools",
    tools: [{ id: "tool-1", name: "read" }],
  });
});

test("addRunningTool does not duplicate an existing tool", () => {
  const phase = { kind: "running_tools" as const, tools: [{ id: "tool-1", name: "read" }] };
  assert.deepEqual(addRunningTool(phase, "tool-1", "read"), phase);
});

test("removeRunningTool keeps remaining tools", () => {
  const phase = {
    kind: "running_tools" as const,
    tools: [
      { id: "tool-1", name: "read" },
      { id: "tool-2", name: "bash" },
    ],
  };

  assert.deepEqual(removeRunningTool(phase, "tool-1"), {
    kind: "running_tools",
    tools: [{ id: "tool-2", name: "bash" }],
  });
});

test("removeRunningTool returns waiting_model after the last tool ends", () => {
  const phase = { kind: "running_tools" as const, tools: [{ id: "tool-1", name: "read" }] };
  assert.deepEqual(removeRunningTool(phase, "tool-1"), { kind: "waiting_model" });
});
