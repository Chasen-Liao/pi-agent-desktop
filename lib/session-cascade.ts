export interface RewriteResult {
  newContent: string;
  changed: boolean;
}

/**
 * Pure function: decide whether to rewrite a child session file's first-line
 * header to change its `parentSession` from `oldParent` to `newParent`.
 *
 * - If the first line is malformed JSON, type is not "session", or
 *   parentSession doesn't match oldParent, returns { newContent: content,
 *   changed: false }.
 * - If newParent is null, removes the parentSession key from the header
 *   (not sets it to null).
 * - Preserves all other header fields and all content beyond the first line.
 */
export function rewriteChildHeader(
  content: string,
  oldParent: string,
  newParent: string | null,
): RewriteResult {
  if (content.length === 0) return { newContent: content, changed: false };

  const newlineIdx = content.indexOf("\n");
  const firstLineRaw = newlineIdx === -1 ? content : content.slice(0, newlineIdx);
  const rest = newlineIdx === -1 ? "" : content.slice(newlineIdx);

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(firstLineRaw) as Record<string, unknown>;
  } catch {
    return { newContent: content, changed: false };
  }

  if (header.type !== "session" || header.parentSession !== oldParent) {
    return { newContent: content, changed: false };
  }

  if (newParent === null) {
    delete header.parentSession;
  } else {
    header.parentSession = newParent;
  }

  return { newContent: JSON.stringify(header) + rest, changed: true };
}
