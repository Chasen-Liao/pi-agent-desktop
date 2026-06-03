const ENV_ALLOWLIST = [
  "PATH",
  "Path",
  "NODE_ENV",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_AI_API_KEY",
];

const ENV_PREFIX_ALLOWLIST = ["PI_"];

export function pickApiKeys(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    if (ENV_ALLOWLIST.includes(k)) {
      out[k] = v;
    } else if (ENV_PREFIX_ALLOWLIST.some((p) => k.startsWith(p))) {
      out[k] = v;
    }
  }
  return out;
}
