export interface SlashSkill {
  name: string;
  description?: string;
  disableModelInvocation?: boolean;
  sourceInfo?: {
    source?: string;
    scope?: string;
  };
}

export type SlashCommandKind = "command" | "skill";

export interface SlashCommandItem {
  id: string;
  label: string;
  insertText: string;
  description: string;
  kind: SlashCommandKind;
  scope?: string;
}

export const BUILTIN_SLASH_COMMANDS: SlashCommandItem[] = [
  { id: "compact", label: "/compact", insertText: "/compact ", description: "压缩当前上下文", kind: "command" },
  { id: "tools", label: "/tools", insertText: "/tools ", description: "选择工具预设", kind: "command" },
  { id: "skills", label: "/skills", insertText: "/skills ", description: "查看或调用可用 skills", kind: "command" },
];

export function getSlashTriggerQuery(value: string, caretIndex: number): string | null {
  if (caretIndex < 1) return null;
  const beforeCaret = value.slice(0, caretIndex);
  if (!beforeCaret.startsWith("/")) return null;
  if (beforeCaret.includes("\n")) return null;
  const query = beforeCaret.slice(1);
  if (/\s/.test(query)) return null;
  return query;
}

export function buildSlashCommandItems(query: string, skills: SlashSkill[]): SlashCommandItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const skillItems = skills
    .filter((skill) => !skill.disableModelInvocation && skill.name.trim())
    .map((skill): SlashCommandItem => ({
      id: `skill:${skill.name}`,
      label: `/${skill.name}`,
      insertText: `/${skill.name} `,
      description: skill.description?.trim() || "Skill",
      kind: "skill",
      scope: skill.sourceInfo?.scope ?? skill.sourceInfo?.source,
    }));

  return [...BUILTIN_SLASH_COMMANDS, ...skillItems].filter((item) => {
    if (!normalizedQuery) return true;
    return item.label.slice(1).toLowerCase().includes(normalizedQuery) ||
      item.description.toLowerCase().includes(normalizedQuery) ||
      item.kind.includes(normalizedQuery);
  });
}
