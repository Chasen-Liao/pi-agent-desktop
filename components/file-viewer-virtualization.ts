export interface VirtualLineWindowInput {
  lineCount: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  overscanRows: number;
}

export interface VirtualLineWindow {
  startIndex: number;
  endIndex: number;
  topPaddingHeight: number;
  bottomPaddingHeight: number;
}

export function getVirtualLineWindow({
  lineCount,
  scrollTop,
  viewportHeight,
  rowHeight,
  overscanRows,
}: VirtualLineWindowInput): VirtualLineWindow {
  const measuredViewportHeight = viewportHeight || rowHeight * 40;
  const visibleCount = Math.ceil(measuredViewportHeight / rowHeight) + overscanRows * 2;
  const rawStartIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
  const startIndex = Math.min(lineCount, rawStartIndex);
  const endIndex = Math.min(lineCount, startIndex + Math.max(visibleCount, overscanRows * 2));

  return {
    startIndex,
    endIndex,
    topPaddingHeight: startIndex * rowHeight,
    bottomPaddingHeight: Math.max(0, (lineCount - endIndex) * rowHeight),
  };
}
