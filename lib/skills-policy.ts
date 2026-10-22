/**
 * Validate a skills.sh package identifier before passing it to `npx skills add`.
 *
 * skills.sh packages use the format: `owner/repo` or `owner/repo@skill-name`.
 * This rejects:
 * - Shell metacharacters (even though runNpx uses execFile, defense in depth)
 * - Path traversal (`..`, absolute paths)
 * - Non-package strings that could be misinterpreted by npm/skills CLI
 *
 * Allowed charset is a strict subset of the one used by the /api/skills/search
 * parser: `owner/repo[@skill]` where owner/repo/skill use word chars, dot, dash,
 * colon, at. The search parser additionally allows `:` and `@` inside the
 * owner/repo segment, so a search result may still be rejected on install.
 *
 * Returns an error message string if rejected, or null if allowed.
 */
export function validateSkillsPackage(pkg: string): string | null {
  const trimmed = pkg.trim();
  if (!trimmed) return "package required";

  // skills.sh format: owner/repo or owner/repo@skill-name
  // The search parser (app/api/skills/search/route.ts:50) is deliberately
  // looser: it also surfaces owner/repo:tag and owner/repo@a@b, which this
  // stricter charset rejects. Install therefore 400s on those two forms.
  const re = /^[\w.-]+\/[\w.-]+(?:@[\w.:-]+)?$/;
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
