/**
 * Validate an auth provider identifier from URL path parameters.
 *
 * Provider names are used by pi-coding-agent's AuthStorage as config keys
 * (and potentially as file names on disk). This rejects path traversal,
 * shell metacharacters, and other characters that could be misinterpreted
 * by downstream layers.
 *
 * Allowed: lowercase letters, digits, hyphens (e.g. "anthropic", "openai",
 * "google", "openrouter"). Matches typical OAuth provider slugs.
 *
 * Returns an error message string if rejected, or null if allowed.
 */
export function validateProviderName(provider: string): string | null {
  if (!provider) return "provider is required";
  // Reasonable length cap to prevent pathological inputs
  if (provider.length > 64) return "provider name too long (max 64 chars)";
  // Allowed: lowercase alpha, digits, hyphens. Must start with a letter.
  if (!/^[a-z][a-z0-9-]*$/.test(provider)) {
    return "Invalid provider name (allowed: lowercase letters, digits, hyphens; must start with a letter)";
  }
  return null;
}
const ALLOWED_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

/**
 * Returns true if the given Origin header value points at localhost or the
 * loopback address.
 */
export function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGIN_RE.test(origin);
}

/**
 * Validates the Origin header on incoming API requests against loopback allowlist.
 * Returns an error message string if rejected (403), or null if allowed.
 */
export function validateRequestOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (origin !== null && !isAllowedOrigin(origin)) {
    return "forbidden origin";
  }
  return null;
}
