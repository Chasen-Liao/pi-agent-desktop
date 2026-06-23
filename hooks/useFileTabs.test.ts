import test from "node:test";
import assert from "node:assert/strict";
import { computeNextActiveId } from "./useFileTabs.ts";
import type { Tab } from "@/components/TabBar";

const tab = (id: string): Tab => ({ id, label: id, filePath: `/p/${id}` });

test("computeNextActiveId: closing the active tab switches to the last remaining tab", () => {
  const remaining = [tab("file:b"), tab("file:c")];
  assert.equal(computeNextActiveId("file:a", "file:a", remaining), "file:c");
});

test("computeNextActiveId: closing a non-active tab leaves active unchanged", () => {
  const remaining = [tab("file:a")];
  assert.equal(computeNextActiveId("file:a", "file:b", remaining), "file:a");
});

test("computeNextActiveId: closing the last tab clears active id", () => {
  assert.equal(computeNextActiveId("file:a", "file:a", []), null);
});

test("computeNextActiveId: when active is already null, closing any tab stays null", () => {
  assert.equal(computeNextActiveId(null, "file:a", []), null);
});

test("computeNextActiveId: closing active when only one remains switches to it", () => {
  const remaining = [tab("file:b")];
  assert.equal(computeNextActiveId("file:a", "file:a", remaining), "file:b");
});

test("computeNextActiveId: closing active id that differs from current returns current", () => {
  // current active ≠ closing → returns current unchanged, ignoring remaining list
  const remaining = [tab("file:z")];
  assert.equal(computeNextActiveId("file:keep", "file:x", remaining), "file:keep");
});
