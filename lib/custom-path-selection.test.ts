const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveCustomPathSelection } = require("./custom-path-selection.ts");

test("selected path updates cwd and closes the picker", () => {
  assert.deepEqual(
    resolveCustomPathSelection("C:\\old", "  C:\\work  "),
    { nextCwd: "C:\\work", shouldClose: true }
  );
});

test("cancelled selection keeps cwd and closes the picker", () => {
  assert.deepEqual(
    resolveCustomPathSelection("C:\\old", null),
    { nextCwd: "C:\\old", shouldClose: true }
  );
});
