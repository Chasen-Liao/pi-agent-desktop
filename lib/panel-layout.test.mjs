import panelAssert from "node:assert/strict";
import panelTest from "node:test";
import panelLayout from "./panel-layout.js";

const { clampPanelWidth, getDefaultPanelWidths } = panelLayout;

panelTest("default panel widths fit a desktop window", () => {
  panelAssert.deepEqual(getDefaultPanelWidths(1200), {
    left: 260,
    right: 504,
  });
});

panelTest("panel widths do not go below their minimums", () => {
  panelAssert.equal(clampPanelWidth("left", 100, 1200), 220);
  panelAssert.equal(clampPanelWidth("right", 100, 1200), 300);
});

panelTest("panel widths are capped by window size", () => {
  panelAssert.equal(clampPanelWidth("left", 900, 1200), 480);
  panelAssert.equal(clampPanelWidth("right", 900, 1200), 720);
});
