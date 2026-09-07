import test from "node:test";
import assert from "node:assert/strict";
import {
  validateBranchPayload,
  validateClonePayload,
  extractAncestryPath,
  createBranchedHeader,
  createClonedHeader,
} from "./session-branch-clone.ts";
import type { SessionEntry, SessionHeader } from "./types.ts";

test("validateBranchPayload accepts valid payloads", () => {
  const res1 = validateBranchPayload({ targetEntryId: "e123" });
  assert.equal(res1.valid, true);
  if (res1.valid) {
    assert.equal(res1.data.targetEntryId, "e123");
    assert.equal(res1.data.name, undefined);
  }

  const res2 = validateBranchPayload({ targetEntryId: "  e456  ", name: "  Branch 1  " });
  assert.equal(res2.valid, true);
  if (res2.valid) {
    assert.equal(res2.data.targetEntryId, "e456");
    assert.equal(res2.data.name, "Branch 1");
  }
});

test("validateBranchPayload rejects invalid payloads", () => {
  assert.equal(validateBranchPayload(null).valid, false);
  assert.equal(validateBranchPayload("string").valid, false);
  assert.equal(validateBranchPayload([]).valid, false);
  assert.equal(validateBranchPayload({}).valid, false);
  assert.equal(validateBranchPayload({ targetEntryId: "" }).valid, false);
  assert.equal(validateBranchPayload({ targetEntryId: 123 }).valid, false);
  assert.equal(validateBranchPayload({ targetEntryId: "e1", name: 999 }).valid, false);
});

test("validateClonePayload accepts valid or empty payloads", () => {
  const res1 = validateClonePayload(undefined);
  assert.equal(res1.valid, true);

  const res2 = validateClonePayload({ targetCwd: "/path/to/project", name: "Fork" });
  assert.equal(res2.valid, true);
  if (res2.valid) {
    assert.equal(res2.data.targetCwd, "/path/to/project");
    assert.equal(res2.data.name, "Fork");
    assert.equal(res2.data.workspaceMode, undefined);
  }

  const res3 = validateClonePayload({
    targetCwd: "  /path/to/worktree  ",
    name: "  Isolated Fork  ",
    workspaceMode: "worktree",
    branchName: "  pi-agent/refactor-ui  ",
  });
  assert.equal(res3.valid, true);
  if (res3.valid) {
    assert.deepEqual(res3.data, {
      targetCwd: "/path/to/worktree",
      name: "Isolated Fork",
      workspaceMode: "worktree",
      branchName: "pi-agent/refactor-ui",
    });
  }
});

test("validateClonePayload rejects invalid payloads", () => {
  assert.equal(validateClonePayload("invalid").valid, false);
  assert.equal(validateClonePayload([1, 2]).valid, false);
  assert.equal(validateClonePayload({ targetCwd: 123 }).valid, false);
  assert.equal(validateClonePayload({ name: true }).valid, false);
  assert.equal(validateClonePayload({ workspaceMode: "sandbox" }).valid, false);
  assert.equal(validateClonePayload({ branchName: 42 }).valid, false);
  assert.equal(validateClonePayload({ branchName: "pi-agent/test" }).valid, false);
  assert.equal(
    validateClonePayload({ workspaceMode: "directory", branchName: "pi-agent/test" }).valid,
    false
  );
});

test("validateClonePayload returns stable error codes", () => {
  const cases: Array<[unknown, string]> = [
    ["invalid", "INVALID_CLONE_PAYLOAD"],
    [{ targetCwd: 123 }, "INVALID_TARGET_CWD"],
    [{ name: true }, "INVALID_CLONE_NAME"],
    [{ workspaceMode: "sandbox" }, "INVALID_WORKSPACE_MODE"],
    [{ branchName: 42 }, "INVALID_BRANCH_NAME"],
    [{ branchName: "pi-agent/test" }, "BRANCH_NAME_REQUIRES_WORKTREE"],
  ];

  for (const [payload, code] of cases) {
    const result = validateClonePayload(payload);
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.code, code);
  }
});

test("validateBranchPayload returns stable error codes", () => {
  const cases: Array<[unknown, string]> = [
    ["invalid", "INVALID_BRANCH_PAYLOAD"],
    [{}, "INVALID_TARGET_ENTRY_ID"],
    [{ targetEntryId: "e1", name: 42 }, "INVALID_BRANCH_NAME"],
  ];

  for (const [payload, code] of cases) {
    const result = validateBranchPayload(payload);
    assert.equal(result.valid, false);
    if (!result.valid) assert.equal(result.code, code);
  }
});

test("extractAncestryPath returns array from root to target entry", () => {
  const e1: SessionEntry = {
    type: "message",
    id: "e1",
    parentId: null,
    timestamp: "2026-07-28T00:00:00Z",
    message: { role: "user", content: "Root" },
  };
  const e2: SessionEntry = {
    type: "message",
    id: "e2",
    parentId: "e1",
    timestamp: "2026-07-28T00:01:00Z",
    message: { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "Ans1" }] },
  };
  const e3: SessionEntry = {
    type: "message",
    id: "e3",
    parentId: "e2",
    timestamp: "2026-07-28T00:02:00Z",
    message: { role: "user", content: "Follow up" },
  };

  const entries = [e1, e2, e3];

  assert.deepEqual(extractAncestryPath(entries, "e3"), [e1, e2, e3]);
  assert.deepEqual(extractAncestryPath(entries, "e2"), [e1, e2]);
  assert.deepEqual(extractAncestryPath(entries, "e1"), [e1]);
  assert.deepEqual(extractAncestryPath(entries, "non-existent"), []);
});

test("extractAncestryPath handles cycle in parent pointers gracefully", () => {
  const e1: SessionEntry = {
    type: "message",
    id: "e1",
    parentId: "e2", // cyclic
    timestamp: "2026-07-28T00:00:00Z",
    message: { role: "user", content: "Root" },
  };
  const e2: SessionEntry = {
    type: "message",
    id: "e2",
    parentId: "e1", // cyclic
    timestamp: "2026-07-28T00:01:00Z",
    message: { role: "assistant", model: "m", provider: "p", content: [] },
  };

  const path = extractAncestryPath([e1, e2], "e2");
  assert.equal(path.length, 2);
});

test("createBranchedHeader creates header with parentSession", () => {
  const header = createBranchedHeader({
    sourceSessionId: "s-parent-123",
    cwd: "/workspace/my-app",
    name: "My Branch",
    newSessionId: "s-branch-456",
  });

  assert.equal(header.type, "session");
  assert.equal(header.id, "s-branch-456");
  assert.equal(header.parentSession, "s-parent-123");
  assert.equal(header.cwd, "/workspace/my-app");
  assert.equal(header.name, "My Branch");
  assert.equal(typeof header.timestamp, "string");
});

test("createBranchedHeader throws error if sourceSessionId or cwd is missing", () => {
  assert.throws(() => createBranchedHeader({ sourceSessionId: "", cwd: "/tmp" }), {
    message: /sourceSessionId is required/,
  });
  assert.throws(() => createBranchedHeader({ sourceSessionId: "s1", cwd: "" }), {
    message: /cwd is required/,
  });
});

test("createClonedHeader clones existing header with new ID and optional cwd override", () => {
  const sourceHeader: SessionHeader = {
    type: "session",
    id: "s-orig-111",
    timestamp: "2026-07-01T00:00:00Z",
    cwd: "/orig/cwd",
  };

  const cloned = createClonedHeader({
    sourceHeader,
    targetCwd: "/new/cwd",
    name: "Cloned Session",
    newSessionId: "s-clone-222",
  });

  assert.equal(cloned.type, "session");
  assert.equal(cloned.id, "s-clone-222");
  assert.equal(cloned.cwd, "/new/cwd");
  assert.equal(cloned.name, "Cloned Session");
  assert.notEqual(cloned.timestamp, sourceHeader.timestamp);
});
