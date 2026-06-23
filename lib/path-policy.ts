import path from "path";
import os from "os";

/**
 * Reject cwd values that would grant the agent file access to dangerous
 * filesystem locations. Prevents one-shot privilege escalation via
 * POST /api/agent/new with cwd="C:\\" or "/".
 *
 * Rejects:
 * - Filesystem root (Windows drive root like "C:\\", POSIX "/")
 * - User home directory itself (subdirs are fine)
 * - Common system directories (Windows: Windows, Program Files, ProgramData;
 *   POSIX: /etc, /usr, /var, /bin, /sbin, /boot, /dev, /sys, /proc)
 *
 * Returns an error message string if rejected, or null if allowed.
 */
export function validateAgentCwd(cwd: string): string | null {
  const normalized = path.resolve(cwd);
  const isWin = process.platform === "win32";
  const lower = isWin ? normalized.toLowerCase() : normalized;
  const home = os.homedir();
  const lowerHome = isWin ? home.toLowerCase() : home;

  // Reject filesystem root
  if (isWin) {
    // Windows drive root: "C:\\" or "C:/"
    if (/^[a-z]:[\\/]?$/i.test(normalized)) {
      return "Filesystem root is not allowed as cwd";
    }
  } else {
    if (normalized === "/") {
      return "Filesystem root is not allowed as cwd";
    }
  }

  // Reject user home itself (subdirs are fine)
  if (lower === lowerHome) {
    return "User home directory is not allowed as cwd (use a subdirectory)";
  }

  // Reject common system directories
  const forbidden = isWin
    ? [
        path.join(home, "..", "..", "Windows"),
        "c:\\windows",
        "c:\\program files",
        "c:\\program files (x86)",
        "c:\\programdata",
      ]
    : ["/etc", "/usr", "/var", "/bin", "/sbin", "/boot", "/dev", "/sys", "/proc"];
  for (const sys of forbidden) {
    const sysNorm = path.resolve(sys);
    const sysLower = isWin ? sysNorm.toLowerCase() : sysNorm;
    if (lower === sysLower || lower.startsWith(sysLower + path.sep)) {
      return `System directory is not allowed as cwd: ${sys}`;
    }
  }

  return null;
}

/**
 * Reject file paths that should never be writable through the agent's file API,
 * even if they live inside an allowed root. Prevents overwriting version control
 * metadata, dependency tree internals, or secret containers — which could turn
 * a compromised agent into a persistent backdoor.
 *
 * Forbidden patterns (path-aware, case-insensitive):
 * - .git/         (version control internals)
 * - .hg/          (Mercurial internals)
 * - .svn/         (Subversion internals)
 * - node_modules/ (dependency tree — postinstall hooks are an RCE vector)
 * - .env, .env.*  (secret containers, matched only as a basename)
 *
 * Note: package.json is deliberately NOT forbidden — the user may legitimately
 * want the agent to edit it. The risk vector is node_modules (where a postinstall
 * hook could be planted), not package.json itself.
 *
 * Returns an error message string if rejected, or null if allowed.
 */
export function validateWritablePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();

  // Check for forbidden directory segments anywhere in path.
  // Matches: "/seg/", "/seg" (end), "seg/" (start), "seg" (whole).
  const forbiddenSegments = [".git/", ".hg/", ".svn/", "node_modules/"];
  for (const seg of forbiddenSegments) {
    const name = seg.replace("/", "");
    if (
      lower.includes("/" + seg) ||
      lower.endsWith("/" + name) ||
      lower.startsWith(seg) ||
      lower === name
    ) {
      return `Writes to ${name}/ directories are forbidden (path contains: ${name})`;
    }
  }

  // Check for .env files as basename (secrets). Matches /.env or /.env.local
  // at end of path, or a bare ".env" / ".env.local" whole path. The leading
  // (?:^|\/) ensures we don't match e.g. "envelope.env.ts".
  const envMatch = lower.match(/(?:^|\/)\.env(?:\.[^\/]+)*$/);
  if (envMatch) {
    return "Writes to .env files are forbidden (may contain secrets)";
  }

  return null;
}
