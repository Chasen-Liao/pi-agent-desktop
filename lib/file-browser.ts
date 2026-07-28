/**
 * Pure helpers for the files API (list/read metadata). Keep route.ts thin.
 */
import path from "path";

export const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "__pycache__",
  ".turbo",
  ".cache",
  "coverage",
  ".pytest_cache",
  ".mypy_cache",
  "target",
  "vendor",
  ".DS_Store",
]);

export const IGNORED_SUFFIXES = [".pyc"] as const;

/** Default max directory entries returned by list (prevents IO storms). */
export const DEFAULT_DIR_LIST_LIMIT = 1000;

export const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

export const AUDIO_EXT_TO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  weba: "audio/webm",
  webm: "audio/webm",
};

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  less: "css",
  json: "json",
  jsonl: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  md: "markdown",
  mdx: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "dockerfile",
  tf: "hcl",
  hcl: "hcl",
  env: "bash",
  gitignore: "bash",
  txt: "text",
};

export function getExt(filePath: string): string {
  return path.basename(filePath).toLowerCase().split(".").pop() ?? "";
}

export function getImageMime(filePath: string): string | null {
  return IMAGE_EXT_TO_MIME[getExt(filePath)] ?? null;
}

export function getAudioMime(filePath: string): string | null {
  return AUDIO_EXT_TO_MIME[getExt(filePath)] ?? null;
}

export function getLanguage(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "bash";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  const ext = base.split(".").pop() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "text";
}

export function shouldIgnoreDirEntryName(name: string): boolean {
  if (IGNORED_DIR_NAMES.has(name)) return true;
  return IGNORED_SUFFIXES.some((s) => name.endsWith(s));
}

export type DirListEntry = {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
};

export function sortDirListEntries(entries: DirListEntry[]): DirListEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Filter ignored names, apply optional limit after sort of name list
 * (stat happens later for survivors only when used by route).
 */
export function filterDirEntryNames(
  names: string[],
  limit = DEFAULT_DIR_LIST_LIMIT
): { names: string[]; truncated: boolean } {
  const filtered = names.filter((name) => !shouldIgnoreDirEntryName(name));
  if (filtered.length <= limit) {
    return { names: filtered, truncated: false };
  }
  // Stable alphabetical take before sort-by-type (dirs preferred after stat).
  // Cap on raw names keeps Promise.all(stat) bounded.
  const sorted = [...filtered].sort((a, b) => a.localeCompare(b));
  return { names: sorted.slice(0, limit), truncated: true };
}

/**
 * After stats: sort dirs first then files; re-apply limit for safety.
 */
export function finalizeDirListEntries(
  entries: DirListEntry[],
  limit = DEFAULT_DIR_LIST_LIMIT
): { entries: DirListEntry[]; truncated: boolean } {
  const sorted = sortDirListEntries(entries);
  if (sorted.length <= limit) {
    return { entries: sorted, truncated: false };
  }
  return { entries: sorted.slice(0, limit), truncated: true };
}

/**
 * Parse HTTP Range header for byte ranges. Returns null if invalid/unsupported form.
 * Pure — no I/O. Used by streamFile path.
 */
export function parseByteRange(
  rangeHeader: string,
  size: number
):
  | { ok: true; start: number; end: number }
  | { ok: false; reason: "malformed" | "unsatisfiable" } {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return { ok: false, reason: "malformed" };

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return { ok: false, reason: "unsatisfiable" };
  }
  end = Math.min(end, size - 1);
  return { ok: true, start, end };
}
