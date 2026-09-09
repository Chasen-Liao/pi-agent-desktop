export const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export function getThinkingLevelsForModel(available: readonly string[] | null | undefined) {
  return THINKING_LEVELS.filter((level) => {
    if (!available) return true;
    if (level === "auto") return true;
    return available.includes(level);
  });
}
