import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDroppedPathMentions,
  getDroppedFilePath,
  getRelativeFilePath,
  normalizeFilePathSlashes,
} from "./file-paths.ts";

test("normalizeFilePathSlashes converts Windows drive paths", () => {
  assert.equal(normalizeFilePathSlashes("D:\\foo\\bar.ts"), "D:/foo/bar.ts");
});

test("getRelativeFilePath returns path under cwd", () => {
  assert.equal(
    getRelativeFilePath("D:/proj/src/a.ts", "D:/proj"),
    "src/a.ts"
  );
  assert.equal(
    getRelativeFilePath("D:/other/a.ts", "D:/proj"),
    "D:/other/a.ts"
  );
});

test("formatDroppedPathMentions builds @mentions relative to cwd", () => {
  assert.equal(
    formatDroppedPathMentions(
      ["D:/proj/src/a.ts", "D:/proj/README.md", "D:/outside/x.pdf"],
      "D:/proj"
    ),
    "@src/a.ts @README.md @D:/outside/x.pdf"
  );
  assert.equal(formatDroppedPathMentions(["  ", ""], "D:/proj"), "");
  assert.equal(
    formatDroppedPathMentions(["D:/proj/a.ts"], null),
    "@D:/proj/a.ts"
  );
});

test("getDroppedFilePath uses electronAPI.getPathForFile when available", () => {
  const previous = (globalThis as { window?: unknown }).window;
  const file = { name: "a.ts" } as File;
  (globalThis as { window: unknown }).window = {
    electronAPI: {
      getPathForFile: (f: File) => {
        assert.equal(f, file);
        return "D:/proj/a.ts";
      },
    },
  };

  try {
    assert.equal(getDroppedFilePath(file), "D:/proj/a.ts");
  } finally {
    if (previous === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = previous;
    }
  }
});

test("getDroppedFilePath falls back to legacy File.path", () => {
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window: unknown }).window = {};
  const file = { name: "a.ts", path: "D:/legacy/a.ts" } as File & { path: string };

  try {
    assert.equal(getDroppedFilePath(file), "D:/legacy/a.ts");
  } finally {
    if (previous === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = previous;
    }
  }
});

test("getDroppedFilePath returns null without host path support", () => {
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window: unknown }).window = {};
  try {
    assert.equal(getDroppedFilePath({ name: "a.ts" } as File), null);
  } finally {
    if (previous === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = previous;
    }
  }
});
