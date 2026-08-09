/**
 * Inline pi extension: long-term memory tools (memory_save / recall / forget).
 * Not gated by Ask-mode confirm (not bash/write/edit).
 */
import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionFactory,
  InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { isLtmDisabledError, isMemoryType, LTM_DISABLED } from "./ltm/http.ts";
import { getMemoryService } from "./ltm/service.ts";
import type { AgentMode } from "./approval-policy.ts";

export const MEMORY_TOOL_NAMES = [
  "memory_save",
  "memory_recall",
  "memory_forget",
] as const;

export type MemoryToolName = (typeof MEMORY_TOOL_NAMES)[number];

const LTM_DISABLED_TEXT = "Long-term memory is disabled";

export type DesktopLtmExtensionOptions = {
  /** Session project cwd; resolved at execute time. */
  getCwd: () => string;
  /** Optional agentDir override for getMemoryService (tests). */
  agentDir?: string;
};

/** Append memory_* tools when any coding tools are active; empty stay empty (noTools: all).
 * Plan mode is read-only: keep only memory_recall, dropping the write/delete
 * channels (memory_save / memory_forget) that would let a plan loop mutate
 * durable project memory. */
export function withMemoryTools(tools: string[], mode?: AgentMode): string[] {
  if (tools.length === 0) return tools;
  const next = [...tools];
  const memoryTools =
    mode === "plan" ? (["memory_recall"] as const) : MEMORY_TOOL_NAMES;
  for (const name of memoryTools) {
    if (!next.includes(name)) next.push(name);
  }
  return next;
}

function textResult(text: string, details: unknown = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function disabledResult() {
  return textResult(LTM_DISABLED_TEXT, { error: LTM_DISABLED });
}

function mapError(err: unknown) {
  if (isLtmDisabledError(err)) return disabledResult();
  const message = err instanceof Error ? err.message : String(err);
  if (message === LTM_DISABLED) return disabledResult();
  return textResult(`Memory error: ${message}`, { error: message });
}

const SaveParams = Type.Object({
  content: Type.String({ description: "Memory content to store" }),
  type: Type.Optional(
    Type.String({
      description:
        "Memory type: pattern | preference | architecture | bug | workflow | fact",
    })
  ),
});

const RecallParams = Type.Object({
  query: Type.String({ description: "Search query for project memory" }),
  limit: Type.Optional(
    Type.Number({ description: "Max hits (1–50, default 10)" })
  ),
});

const ForgetParams = Type.Object({
  memoryIds: Type.Optional(
    Type.Array(Type.String(), { description: "Memory ids to delete" })
  ),
});

export function createDesktopLtmFactory(
  options: DesktopLtmExtensionOptions
): ExtensionFactory {
  const { getCwd, agentDir } = options;

  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "memory_save",
      label: "Memory Save",
      description:
        "Save a durable project memory (preference, architecture note, bug, fact, etc.).",
      promptSnippet: "Save long-term project memory",
      parameters: SaveParams,
      async execute(_toolCallId, params) {
        try {
          const service = getMemoryService(agentDir);
          if (!service.isEnabled()) return disabledResult();

          const type =
            params.type !== undefined && isMemoryType(params.type)
              ? params.type
              : undefined;
          if (params.type !== undefined && type === undefined) {
            return textResult(
              `Invalid memory type: ${String(params.type)}. Use pattern|preference|architecture|bug|workflow|fact.`,
              { error: "invalid_type" }
            );
          }

          const result = await service.rememberFromCwd(getCwd(), {
            content: params.content,
            ...(type !== undefined ? { type } : {}),
          });
          return textResult(
            `Saved memory ${result.id} (type: ${result.type})`,
            result
          );
        } catch (err) {
          return mapError(err);
        }
      },
    });

    pi.registerTool({
      name: "memory_recall",
      label: "Memory Recall",
      description:
        "Search project long-term memory and observations by query.",
      promptSnippet: "Recall project long-term memory",
      parameters: RecallParams,
      async execute(_toolCallId, params) {
        try {
          const service = getMemoryService(agentDir);
          if (!service.isEnabled()) return disabledResult();

          const limit =
            typeof params.limit === "number" && Number.isFinite(params.limit)
              ? Math.min(50, Math.max(1, Math.floor(params.limit)))
              : undefined;

          const hits = await service.recallFromCwd(getCwd(), {
            query: params.query,
            ...(limit !== undefined ? { limit } : {}),
          });

          if (hits.length === 0) {
            return textResult("No matching memories.", { hits: [] });
          }

          const lines = hits.map((h, i) => {
            const score =
              h.score !== undefined ? ` score=${h.score.toFixed(3)}` : "";
            const kind = h.kind;
            const type = h.type ? ` (${h.type})` : "";
            return `${i + 1}. [${kind}${type}] ${h.id}${score}\n   ${h.title}\n   ${h.snippet}`;
          });

          return textResult(lines.join("\n\n"), { hits });
        } catch (err) {
          return mapError(err);
        }
      },
    });

    pi.registerTool({
      name: "memory_forget",
      label: "Memory Forget",
      description: "Delete project memories by id.",
      promptSnippet: "Forget (delete) project memories by id",
      parameters: ForgetParams,
      async execute(_toolCallId, params) {
        try {
          const service = getMemoryService(agentDir);
          if (!service.isEnabled()) return disabledResult();

          const memoryIds = params.memoryIds;
          if (!memoryIds || memoryIds.length === 0) {
            return textResult("No memoryIds provided; nothing deleted.", {
              deleted: 0,
            });
          }

          const result = await service.forgetFromCwd(getCwd(), { memoryIds });
          return textResult(`Deleted ${result.deleted} memor(ies).`, result);
        } catch (err) {
          return mapError(err);
        }
      },
    });
  };
}

export function desktopLtmInlineExtension(
  options: DesktopLtmExtensionOptions
): InlineExtension {
  return {
    name: "desktop-ltm",
    factory: createDesktopLtmFactory(options),
  };
}
