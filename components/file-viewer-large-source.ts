export const LARGE_SOURCE_BYTES = 200_000;
export const LARGE_SOURCE_LINES = 5_000;

/**
 * True when source view should fall back to the virtualized plain-text
 * viewer. Markdown preview and diff views keep priority over this fallback;
 * the caller passes hasContent=false while the file is still loading.
 */
export function shouldUseLargeSourceViewer({
  hasContent,
  viewMode,
  previewMode,
  contentLength,
  lineCount,
}: {
  hasContent: boolean;
  viewMode: string;
  previewMode: boolean;
  contentLength: number;
  lineCount: number;
}): boolean {
  return Boolean(
    hasContent
    && viewMode === "source"
    && !previewMode
    && (contentLength > LARGE_SOURCE_BYTES || lineCount > LARGE_SOURCE_LINES)
  );
}
