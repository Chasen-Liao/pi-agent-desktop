export function resolveCustomPathSelection(currentCwd: string | null, selectedPath: string | null) {
  const trimmed = selectedPath?.trim();
  return {
    nextCwd: trimmed ? trimmed : currentCwd,
    shouldClose: true,
  };
}
