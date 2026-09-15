import type { AssistantContentBlock, ImageContent, TextContent } from "../lib/types";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null;
}

function isTextContent(value: unknown): value is TextContent {
  return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function isImageContent(value: unknown): value is ImageContent {
  return isRecord(value) && value.type === "image" && isRecord(value.source);
}

const ASSISTANT_BLOCK_TYPES = new Set(["text", "image", "thinking", "toolCall"]);

function isAssistantContentBlock(value: unknown): value is AssistantContentBlock {
  return isRecord(value)
    && typeof value.type === "string"
    && ASSISTANT_BLOCK_TYPES.has(value.type);
}

/**
 * Convert a message content payload to displayable text.
 * Runtime payloads can come from old/corrupt session files or an extension,
 * so malformed non-array values must degrade to an empty string instead of
 * throwing during React render.
 */
export function getTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter(isTextContent)
    .map((block) => block.text)
    .join("\n");
}

/** Return recognized assistant blocks from a runtime message payload. */
export function getAssistantContent(content: unknown): AssistantContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter(isAssistantContentBlock);
}

/** Return only valid image blocks from a runtime message payload. */
export function getImageContent(content: unknown): ImageContent[] {
  if (!Array.isArray(content)) return [];
  return content.filter(isImageContent);
}
