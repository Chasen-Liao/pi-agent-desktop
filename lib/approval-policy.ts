/**
 * AgentMode + tool-preset → effective tools / Ask-confirm membership.
 * Pure policy — no I/O, no React.
 */

export type AgentMode = "plan" | "ask" | "full";
export type ToolPreset = "none" | "default" | "full";

export const BUILTIN_TOOL_NAMES: readonly string[] = [
  "read",
  "bash",
  "powershell",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
];

export const READ_ONLY_TOOLS: readonly string[] = [
  "read",
  "grep",
  "find",
  "ls",
  "memory_recall",
];

export const PLAN_TOOLS: readonly string[] = ["read", "grep", "find", "ls"];
export const ASK_CONFIRM_TOOLS: readonly string[] = [
  "bash",
  "powershell",
  "write",
  "edit",
  // LTM write/delete channels mutate durable project memory; keep them behind
  // the same Ask confirm as filesystem writes.
  "memory_save",
  "memory_forget",
];

export const PRESET_NONE: readonly string[] = [];
export const PRESET_DEFAULT: readonly string[] = ["read", "bash", "edit", "write"];
export const PRESET_FULL: readonly string[] = [
  "bash",
  "powershell",
  "read",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
];

export const DEFAULT_AGENT_MODE: AgentMode = "full";
export const DEFAULT_TOOL_PRESET: ToolPreset = "default";

export const EXECUTE_PLAN_PROMPT =
  "请按你刚才的计划开始执行。需要写入文件或运行命令前会请求我确认。";

export function isAgentMode(value: unknown): value is AgentMode {
  return value === "plan" || value === "ask" || value === "full";
}

export function isToolPreset(value: unknown): value is ToolPreset {
  return value === "none" || value === "default" || value === "full";
}

export function toolNamesForPreset(
  preset: ToolPreset,
  customTools: readonly string[] = []
): string[] {
  if (preset === "none") return [...PRESET_NONE];
  if (preset === "full") return [...PRESET_FULL, ...customTools];
  return [...PRESET_DEFAULT, ...customTools];
}

/**
 * Tools actually enabled for the session given mode + preset.
 * Plan always forces the four read-side tools (even if preset is none).
 */
export function effectiveToolsForMode(
  mode: AgentMode,
  preset: ToolPreset,
  customTools: readonly string[] = []
): string[] {
  if (mode === "plan") return [...PLAN_TOOLS];
  return toolNamesForPreset(preset, customTools);
}

export interface ToolLike {
  name: string;
  sourceInfo?: {
    source?: string;
  };
}

/**
 * Extract custom (non-builtin, non-memory) tool names from a list of tool names or definitions.
 */
export function extractCustomToolNames(
  allTools: readonly (string | ToolLike)[]
): string[] {
  const knownBuiltins = new Set<string>([
    ...BUILTIN_TOOL_NAMES,
    "memory_save",
    "memory_recall",
    "memory_forget",
  ]);
  const custom: string[] = [];
  for (const t of allTools) {
    if (typeof t === "string") {
      if (!knownBuiltins.has(t)) custom.push(t);
    } else {
      const name = t.name;
      const isBuiltinSource = t.sourceInfo?.source === "builtin";
      const isMemoryTool = name.startsWith("memory_");
      if (!isBuiltinSource && !isMemoryTool) {
        // Any non-builtin tool is custom, even if its name collides with a builtin
        custom.push(name);
      } else if (!knownBuiltins.has(name)) {
        custom.push(name);
      }
    }
  }
  return custom;
}

/**
 * Whether Ask mode requires a confirm dialog before this tool runs.
 * In Ask mode, mutating built-ins (bash/powershell/write/edit/memory_save/memory_forget)
 * and all custom extension-registered tools require user confirmation.
 * Only recognized read-only tools (read, grep, find, ls, memory_recall) bypass confirmation.
 */
export function needsAskConfirm(mode: AgentMode, toolName: string, isCustom = false): boolean {
  if (mode !== "ask") return false;
  if (isCustom) return true;
  return !READ_ONLY_TOOLS.includes(toolName);
}

export function askBlockResult(): { block: true; reason: string } {
  return { block: true, reason: "Blocked by user (Ask mode)" };
}

/** Short human-readable summary for confirm dialogs. */
export function summarizeToolCall(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") {
    return `${toolName}(${JSON.stringify(input ?? {})})`;
  }
  const obj = input as Record<string, unknown>;
  if (toolName === "bash" && typeof obj.command === "string") {
    const cmd = obj.command.length > 200 ? `${obj.command.slice(0, 200)}…` : obj.command;
    return `bash: ${cmd}`;
  }
  if ((toolName === "write" || toolName === "edit") && typeof obj.path === "string") {
    return `${toolName}: ${obj.path}`;
  }
  if (typeof obj.file_path === "string") {
    return `${toolName}: ${obj.file_path}`;
  }
  if (typeof obj.query === "string") {
    const q = obj.query.length > 200 ? `${obj.query.slice(0, 200)}…` : obj.query;
    return `${toolName}: ${q}`;
  }
  try {
    const s = JSON.stringify(obj);
    return s.length > 240 ? `${toolName}: ${s.slice(0, 240)}…` : `${toolName}: ${s}`;
  } catch {
    return toolName;
  }
}
