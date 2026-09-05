import assert from "node:assert/strict";
import test from "node:test";
import { getExtensionRenderKey } from "./extension-render-key.ts";

test("getExtensionRenderKey distinguishes extensions by scope, source and path", () => {
  const base = { scope: "user", source: "path", path: "/a/b" };

  assert.notEqual(
    getExtensionRenderKey(base),
    getExtensionRenderKey({ ...base, scope: "project" }),
  );
  assert.notEqual(
    getExtensionRenderKey(base),
    getExtensionRenderKey({ ...base, source: "builtin" }),
  );
  assert.notEqual(
    getExtensionRenderKey(base),
    getExtensionRenderKey({ ...base, path: "/a/c" }),
  );
  assert.equal(getExtensionRenderKey(base), getExtensionRenderKey({ ...base }));
});
