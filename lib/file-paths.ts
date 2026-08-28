export function normalizeFilePathSlashes(filePath: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\")) {
    return filePath.replace(/\\/g, "/");
  }
  return filePath;
}

export function encodeFilePathForApi(filePath: string): string {
  return normalizeFilePathSlashes(filePath)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export function getFileName(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath).replace(/\/+$/, "");
  return normalized.split("/").pop() ?? normalized;
}

export function getRelativeFilePath(filePath: string, cwd?: string): string {
  if (!cwd) return filePath;

  const normalizedFile = normalizeFilePathSlashes(filePath);
  const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
  if (normalizedFile.startsWith(normalizedCwd + "/")) {
    return normalizedFile.slice(normalizedCwd.length + 1);
  }
  return filePath;
}

export function joinFilePath(parent: string, child: string): string {
  return `${normalizeFilePathSlashes(parent).replace(/\/$/, "")}/${child}`;
}

/** Absolute path of a drag-dropped File, or null when the host cannot expose it (browser). */
export function getDroppedFilePath(file: File): string | null {
  if (typeof window !== "undefined") {
    const api = (window as Window & {
      electronAPI?: { getPathForFile?: (file: File) => string };
    }).electronAPI?.getPathForFile;
    if (typeof api === "function") {
      try {
        const path = api(file);
        if (typeof path === "string" && path.trim()) return path;
      } catch {
        // fall through to legacy File.path
      }
    }
  }

  const legacyPath = (file as File & { path?: string }).path;
  if (typeof legacyPath === "string" && legacyPath.trim()) return legacyPath;
  return null;
}

/** Build `@rel` / `@abs` mentions for dropped files (cwd-relative when possible). */
export function formatDroppedPathMentions(absolutePaths: string[], cwd?: string | null): string {
  const mentions = absolutePaths
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `@${getRelativeFilePath(p, cwd ?? undefined)}`);
  return mentions.join(" ");
}
