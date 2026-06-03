const DEFAULT_SKILLS_API_BASE = "https://skills.sh";

export function getAllowedSkillsApiBase(rawBase = process.env.SKILLS_API_URL, nodeEnv = process.env.NODE_ENV): string {
  if (!rawBase) return DEFAULT_SKILLS_API_BASE;

  try {
    const parsed = new URL(rawBase);
    const isDefaultHost = parsed.protocol === "https:" && parsed.hostname === "skills.sh" && (!parsed.port || parsed.port === "443");
    const isLocalDevHost = nodeEnv !== "production"
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
      && (parsed.protocol === "http:" || parsed.protocol === "https:");

    if (!isDefaultHost && !isLocalDevHost) {
      console.error("Ignoring unsupported SKILLS_API_URL", { value: rawBase });
      return DEFAULT_SKILLS_API_BASE;
    }

    parsed.pathname = parsed.pathname.replace(/\/$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    console.error("Ignoring invalid SKILLS_API_URL", { value: rawBase });
    return DEFAULT_SKILLS_API_BASE;
  }
}

export function buildSkillsSearchUrl(base: string, query: string, limit: number): URL {
  const url = new URL("/api/search", base);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  return url;
}

export function buildSkillUrl(base: string, slug: string): string {
  const url = new URL(base);
  url.pathname = slug
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  url.search = "";
  url.hash = "";
  return url.toString();
}
