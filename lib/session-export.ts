import type {
  SessionEntry,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  AssistantContentBlock,
  TextContent,
  ImageContent,
} from "./types.ts";
import {
  exportFromFile,
  exportSessionToHtml as piExportSessionToHtml,
  type ExportOptions,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/index.js";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

export type HtmlExportOptions = ExportOptions;

function formatUserContent(content: string | (TextContent | ImageContent)[]): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (item.type === "text") return item.text;
        if (item.type === "image") return "[Image]";
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function formatAssistantContent(content: AssistantContentBlock[]): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];

  for (const block of content) {
    if (block.type === "text") {
      if (block.text?.trim()) {
        parts.push(block.text.trim());
      }
    } else if (block.type === "thinking") {
      if (block.thinking?.trim()) {
        parts.push(`> *Thinking:*\n> ${block.thinking.trim().replace(/\n/g, "\n> ")}`);
      }
    } else if (block.type === "toolCall") {
      const inputJson = JSON.stringify(block.input ?? {}, null, 2);
      parts.push(`### Tool Call: \`${block.toolName}\`\n\`\`\`json\n${inputJson}\n\`\`\``);
    } else if (block.type === "image") {
      parts.push("[Image]");
    }
  }

  return parts.join("\n\n").trim();
}

function formatToolResultContent(msg: ToolResultMessage): string {
  const toolNameStr = msg.toolName ? `\`${msg.toolName}\`` : `\`${msg.toolCallId}\``;
  const errorHeader = msg.isError ? " (Error)" : "";

  const textParts = (msg.content || [])
    .map((item) => {
      if (item.type === "text") return item.text;
      if (item.type === "image") return "[Image]";
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();

  return `### Tool Result: ${toolNameStr}${errorHeader}\n\`\`\`\n${textParts}\n\`\`\``;
}

export function formatEntriesToMarkdown(entries: SessionEntry[]): string {
  const blocks: string[] = [];

  for (const entry of entries) {
    if (entry.type === "message") {
      const msg = entry.message;
      if (msg.role === "user") {
        const userContent = formatUserContent(msg.content);
        if (userContent) {
          blocks.push(`## User\n\n${userContent}`);
        }
      } else if (msg.role === "assistant") {
        const assistantContent = formatAssistantContent(msg.content);
        if (assistantContent) {
          blocks.push(`## Assistant\n\n${assistantContent}`);
        }
      } else if (msg.role === "toolResult") {
        const toolResultContent = formatToolResultContent(msg);
        if (toolResultContent) {
          blocks.push(toolResultContent);
        }
      } else if (msg.role === "custom") {
        if (msg.display) {
          const customContent = formatUserContent(msg.content);
          if (customContent) {
            blocks.push(`## Custom (${msg.customType})\n\n${customContent}`);
          }
        }
      }
    } else if (entry.type === "compaction") {
      if (entry.summary) {
        blocks.push(`> *Session compacted: ${entry.summary.trim()}*`);
      }
    } else if (entry.type === "custom_message") {
      if (entry.display && entry.content) {
        const customMsgContent = formatUserContent(entry.content);
        if (customMsgContent) {
          blocks.push(`## Custom (${entry.customType})\n\n${customMsgContent}`);
        }
      }
    }
  }

  return blocks.join("\n\n").trim();
}

export async function exportSessionToHtml(
  input: string | SessionManager,
  options?: HtmlExportOptions
): Promise<string> {
  if (typeof input === "string") {
    return exportFromFile(input, options);
  }
  return piExportSessionToHtml(input, undefined, options);
}
