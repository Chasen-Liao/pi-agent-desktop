const LEFT_PANEL_DEFAULT_WIDTH = 260;
const LEFT_PANEL_MIN_WIDTH = 220;
const LEFT_PANEL_MAX_WIDTH = 480;

const RIGHT_PANEL_DEFAULT_RATIO = 0.42;
const RIGHT_PANEL_MIN_WIDTH = 300;
const RIGHT_PANEL_MAX_RATIO = 0.6;

function clampPanelWidth(side, width, windowWidth) {
  const min = side === "left" ? LEFT_PANEL_MIN_WIDTH : RIGHT_PANEL_MIN_WIDTH;
  const max = side === "left"
    ? Math.min(LEFT_PANEL_MAX_WIDTH, Math.floor(windowWidth * 0.45))
    : Math.floor(windowWidth * RIGHT_PANEL_MAX_RATIO);
  return Math.min(Math.max(Math.round(width), min), max);
}

function getDefaultPanelWidths(windowWidth) {
  return {
    left: clampPanelWidth("left", LEFT_PANEL_DEFAULT_WIDTH, windowWidth),
    right: clampPanelWidth("right", windowWidth * RIGHT_PANEL_DEFAULT_RATIO, windowWidth),
  };
}

module.exports = {
  LEFT_PANEL_DEFAULT_WIDTH,
  LEFT_PANEL_MIN_WIDTH,
  LEFT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_DEFAULT_RATIO,
  RIGHT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_MAX_RATIO,
  clampPanelWidth,
  getDefaultPanelWidths,
};
