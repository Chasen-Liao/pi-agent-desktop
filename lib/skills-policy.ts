/**
 * Validate a skills.sh package identifier before passing it to `npx skills add`.
 *
 * skills.sh packages use the format: `owner/repo` or `owner/repo@skill-name`.
 * This rejects:
 * - Shell metacharacters (even though runNpx uses execFile, defense in depth)
 * - Path traversal (`..`, absolute paths)
 * - Non-package strings that could be misinterpreted by npm/skills CLI
 *
 * Allowed charset mirrors the one already used by /api/skills/search parser:
 * `owner/repo[@skill]` where owner/repo/skill use word chars, dot, dash, colon, at.
 *
 * Returns an error message string if rejected, or null if allowed.
 */
export function validateSkillsPackage(pkg: string): string | null {
  const trimmed = pkg.trim();
  if (!trimmed) return "package required";

  // skills.sh format: owner/repo or owner/repo@skill-name
  // Same charset as the search parser at app/api/skills/search/route.ts:52
  // to ensure install can only be called with packages that search would surface.
  const re = /^[\w.\-]+\/[\w.\-@:]+$/;
  if (!re.test(trimmed)) {
    return `Invalid package identifier (expected owner/repo[@skill] format, allowed chars: word, ".", "-", "@", ":")`;
  }

  // Defense in depth: reject shell metacharacters even though runNpx uses execFile
  if (/[;&|`$(){}!<>\\\n\r"']/.test(trimmed)) {
    return "Package identifier contains forbidden characters";
  }

  // Reject path traversal attempts
  if (trimmed.includes("..")) {
    return "Package identifier contains '..'";
  }

  return null;
}
