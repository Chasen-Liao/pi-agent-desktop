import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createPiRuntime } from "../pi-runtime.ts";
import type { UpstreamProviderUsage, UpstreamWindowUsage } from "./types.ts";

interface CacheEntry {
  data?: UpstreamProviderUsage;
  pending?: Promise<UpstreamProviderUsage | null>;
  expiresAt: number;
  fetchedAt: number;
}

declare global {
  var __piUpstreamUsageCache: Map<string, CacheEntry> | undefined;
}

function getCache(): Map<string, CacheEntry> {
  return (globalThis.__piUpstreamUsageCache ??= new Map<string, CacheEntry>());
}

export const CACHE_TTL_MS = 120 * 1000; // 120 seconds TTL to protect upstream rate limits
export const REFRESH_COOLDOWN_MS = 15 * 1000; // 15 seconds cooldown debounce on manual refresh
const REQUEST_TIMEOUT_MS = 5000;

export interface AuthStorageContent {
  [providerId: string]: {
    type?: string;
    key?: string;
    apiKey?: string;
    token?: string;
    access?: string;
    refresh?: string;
    expires?: number;
    accountId?: string;
    [key: string]: unknown;
  };
}

export function readStoredAuth(agentDir = getAgentDir()): AuthStorageContent {
  try {
    const authPath = join(agentDir, "auth.json");
    if (!existsSync(authPath)) return {};
    const raw = readFileSync(authPath, "utf-8");
    return JSON.parse(raw) as AuthStorageContent;
  } catch (err) {
    console.warn("Failed to read auth.json:", err);
    return {};
  }
}

export async function fetchOpenAICodexUsage(
  auth: AuthStorageContent["string"],
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<UpstreamProviderUsage> {
  const token = auth.access ?? auth.token;
  if (!token) {
    return {
      provider: "openai-codex",
      providerName: "OpenAI Codex",
      error: "No access token found in auth.json",
      updatedAt: Date.now(),
    };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "application/json",
  };
  if (auth.accountId) {
    headers["chatgpt-account-id"] = String(auth.accountId);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetchImpl("https://chatgpt.com/backend-api/wham/usage", {
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        provider: "openai-codex",
        providerName: "OpenAI Codex",
        error: res.statusText ? `HTTP ${res.status}: ${res.statusText}` : `HTTP ${res.status}`,
        updatedAt: Date.now(),
      };
    }

    const json = (await res.json()) as {
      plan_type?: string;
      rate_limit?: {
        primary_window?: {
          used_percent?: number;
          limit_window_seconds?: number;
          reset_after_seconds?: number;
          reset_at?: number;
        };
        secondary_window?: {
          used_percent?: number;
          limit_window_seconds?: number;
          reset_after_seconds?: number;
          reset_at?: number;
        };
      };
      credits?: {
        balance?: string;
        unlimited?: boolean;
      };
    };

    const windows: UpstreamWindowUsage[] = [];
    if (json.rate_limit?.primary_window) {
      const pw = json.rate_limit.primary_window;
      const usedPct =
        typeof pw.used_percent === "number" && Number.isFinite(pw.used_percent)
          ? Math.round(pw.used_percent)
          : 0;
      windows.push({
        id: "5h",
        label: "5h",
        usedPercent: usedPct,
        resetAfterSeconds: pw.reset_after_seconds,
        resetAt: pw.reset_at ? pw.reset_at * 1000 : undefined,
      });
    }
    if (json.rate_limit?.secondary_window) {
      const sw = json.rate_limit.secondary_window;
      const usedPct =
        typeof sw.used_percent === "number" && Number.isFinite(sw.used_percent)
          ? Math.round(sw.used_percent)
          : 0;
      windows.push({
        id: "7d",
        label: "7d",
        usedPercent: usedPct,
        resetAfterSeconds: sw.reset_after_seconds,
        resetAt: sw.reset_at ? sw.reset_at * 1000 : undefined,
      });
    }

    const remainingCredits =
      json.credits?.balance != null ? Number(json.credits.balance) : NaN;
    const hasValidRemaining = Number.isFinite(remainingCredits);

    return {
      provider: "openai-codex",
      providerName: "OpenAI Codex",
      planType: json.plan_type,
      windows,
      rawLimit: hasValidRemaining
        ? {
            remaining: remainingCredits,
          }
        : undefined,
      updatedAt: Date.now(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && (err.name === "AbortError" || /abort|timeout|cancel/i.test(err.message));
    return {
      provider: "openai-codex",
      providerName: "OpenAI Codex",
      error: isAbort ? "Request timed out" : msg,
      updatedAt: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDeepSeekBalance(
  auth: AuthStorageContent["string"],
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<UpstreamProviderUsage> {
  const apiKey = auth.key ?? auth.apiKey ?? auth.token;
  if (!apiKey) {
    return {
      provider: "deepseek",
      providerName: "DeepSeek",
      error: "No API key found in auth.json",
      updatedAt: Date.now(),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetchImpl("https://api.deepseek.com/user/balance", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        provider: "deepseek",
        providerName: "DeepSeek",
        error: res.statusText ? `HTTP ${res.status}: ${res.statusText}` : `HTTP ${res.status}`,
        updatedAt: Date.now(),
      };
    }

    const json = (await res.json()) as {
      is_available?: boolean;
      balance_infos?: Array<{
        currency?: string;
        total_balance?: string;
        granted_balance?: string;
        topped_up_balance?: string;
      }>;
    };

    const balances = (json.balance_infos ?? []).map((b) => ({
      currency: b.currency ?? "CNY",
      total: b.total_balance ?? "0.00",
      granted: b.granted_balance,
      toppedUp: b.topped_up_balance,
    }));

    return {
      provider: "deepseek",
      providerName: "DeepSeek",
      balance: balances,
      updatedAt: Date.now(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && (err.name === "AbortError" || /abort|timeout|cancel/i.test(err.message));
    return {
      provider: "deepseek",
      providerName: "DeepSeek",
      error: isAbort ? "Request timed out" : msg,
      updatedAt: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchOpenRouterUsage(
  auth: AuthStorageContent["string"],
  providerKey = "openrouter",
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<UpstreamProviderUsage> {
  const apiKey = auth.key ?? auth.apiKey ?? auth.access ?? auth.token;
  if (!apiKey) {
    return {
      provider: providerKey,
      providerName: "OpenRouter",
      error: "No API key found in auth.json",
      updatedAt: Date.now(),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetchImpl("https://openrouter.ai/api/v1/auth/key", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        provider: providerKey,
        providerName: "OpenRouter",
        error: res.statusText ? `HTTP ${res.status}: ${res.statusText}` : `HTTP ${res.status}`,
        updatedAt: Date.now(),
      };
    }

    const json = (await res.json()) as {
      data?: {
        label?: string;
        usage?: number;
        limit?: number | null;
        limit_remaining?: number | null;
        is_free_tier?: boolean;
        free_model_daily_requests?: {
          used?: number;
          limit?: number;
          remaining?: number;
        };
      };
    };

    const d = json.data;
    const windows: UpstreamWindowUsage[] = [];
    if (d?.free_model_daily_requests) {
      const freeReq = d.free_model_daily_requests;
      const limit = freeReq.limit;
      if (typeof limit === "number" && limit > 0) {
        const usedPct = Math.round(((freeReq.used ?? 0) / limit) * 100);
        windows.push({
          id: "daily_free",
          label: "Daily Free Requests",
          usedPercent: usedPct,
        });
      }
    }

    return {
      provider: providerKey,
      providerName: "OpenRouter",
      planType: d?.is_free_tier ? "Free Tier" : "Pay-as-you-go",
      windows: windows.length > 0 ? windows : undefined,
      rawLimit: {
        used: d?.usage,
        limit: d?.limit,
        remaining: d?.limit_remaining,
      },
      updatedAt: Date.now(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && (err.name === "AbortError" || /abort|timeout|cancel/i.test(err.message));
    return {
      provider: providerKey,
      providerName: "OpenRouter",
      error: isAbort ? "Request timed out" : msg,
      updatedAt: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAnthropicUsage(
  auth: AuthStorageContent["string"],
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<UpstreamProviderUsage> {
  const token = auth.access ?? auth.token;
  if (!token) {
    return {
      provider: "anthropic",
      providerName: "Anthropic Claude",
      error: "No access token found in auth.json",
      updatedAt: Date.now(),
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetchImpl("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        provider: "anthropic",
        providerName: "Anthropic Claude",
        error: res.statusText ? `HTTP ${res.status}: ${res.statusText}` : `HTTP ${res.status}`,
        updatedAt: Date.now(),
      };
    }

    const json = (await res.json()) as {
      five_hour?: { utilization?: number; resets_at?: string };
      seven_day?: { utilization?: number; resets_at?: string };
    };

    const windows: UpstreamWindowUsage[] = [];
    if (
      typeof json.five_hour?.utilization === "number" &&
      Number.isFinite(json.five_hour.utilization)
    ) {
      const resetDate = json.five_hour.resets_at ? new Date(json.five_hour.resets_at) : null;
      const isValidDate = Boolean(resetDate && !isNaN(resetDate.getTime()));
      const resetAfterSec = isValidDate
        ? Math.max(0, Math.floor((resetDate!.getTime() - Date.now()) / 1000))
        : undefined;
      windows.push({
        id: "5h",
        label: "5h",
        usedPercent: Math.round(json.five_hour.utilization),
        resetAfterSeconds: resetAfterSec,
        resetAt: isValidDate ? resetDate!.getTime() : undefined,
      });
    }
    if (
      typeof json.seven_day?.utilization === "number" &&
      Number.isFinite(json.seven_day.utilization)
    ) {
      const resetDate = json.seven_day.resets_at ? new Date(json.seven_day.resets_at) : null;
      const isValidDate = Boolean(resetDate && !isNaN(resetDate.getTime()));
      const resetAfterSec = isValidDate
        ? Math.max(0, Math.floor((resetDate!.getTime() - Date.now()) / 1000))
        : undefined;
      windows.push({
        id: "7d",
        label: "7d",
        usedPercent: Math.round(json.seven_day.utilization),
        resetAfterSeconds: resetAfterSec,
        resetAt: isValidDate ? resetDate!.getTime() : undefined,
      });
    }

    return {
      provider: "anthropic",
      providerName: "Anthropic Claude",
      windows,
      updatedAt: Date.now(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && (err.name === "AbortError" || /abort|timeout|cancel/i.test(err.message));
    return {
      provider: "anthropic",
      providerName: "Anthropic Claude",
      error: isAbort ? "Request timed out" : msg,
      updatedAt: Date.now(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeProviderId(providerId: string, auth: AuthStorageContent): string {
  if (providerId === "openai" && auth["openai-codex"]) {
    return "openai-codex";
  }
  return providerId;
}

function usableStoredAuth(stored: AuthStorageContent["string"]): AuthStorageContent["string"] {
  if (
    stored.type === "oauth" &&
    typeof stored.expires === "number" &&
    stored.expires <= Date.now() + REQUEST_TIMEOUT_MS
  ) {
    return {};
  }
  return stored;
}

async function resolveProviderAuth(
  providerId: string,
  stored: AuthStorageContent["string"]
): Promise<AuthStorageContent["string"]> {
  try {
    const { runtime } = await createPiRuntime({ allowModelNetwork: false });
    const resolved = await runtime.getAuth(providerId, { minOAuthValidityMs: REQUEST_TIMEOUT_MS });
    if (!resolved) return usableStoredAuth(stored);

    const headers = resolved.auth.headers ?? {};
    const accountId = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === "chatgpt-account-id"
    )?.[1];
    return {
      ...stored,
      key: resolved.auth.apiKey ?? stored.key,
      apiKey: resolved.auth.apiKey ?? stored.apiKey,
      access: resolved.auth.apiKey ?? stored.access,
      accountId: accountId != null ? String(accountId) : stored.accountId,
    };
  } catch (error) {
    console.warn(`Failed to resolve refreshed auth for ${providerId}:`, error);
    return usableStoredAuth(stored);
  }
}

export async function getUpstreamProviderUsage(
  providerId: string,
  options: { forceRefresh?: boolean; auth?: AuthStorageContent; fetchImpl?: typeof fetch; now?: number } = {}
): Promise<UpstreamProviderUsage | null> {
  const authData = options.auth ?? readStoredAuth();
  const effectiveProviderId = normalizeProviderId(providerId, authData);

  const now = options.now ?? Date.now();
  const cache = getCache();
  const cached = cache.get(effectiveProviderId);

  if (cached?.pending) return cached.pending;
  if (cached?.data) {
    if (!options.forceRefresh && cached.expiresAt > now) return cached.data;
    if (options.forceRefresh && now - cached.fetchedAt < REFRESH_COOLDOWN_MS) return cached.data;
  }

  const storedAuth = authData[effectiveProviderId];
  if (!storedAuth) return null;

  const request = (async (): Promise<UpstreamProviderUsage | null> => {
    const providerAuth = options.auth
      ? storedAuth
      : await resolveProviderAuth(effectiveProviderId, storedAuth);
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    let result: UpstreamProviderUsage | null = null;

    if (effectiveProviderId === "openai-codex") {
      result = await fetchOpenAICodexUsage(providerAuth, fetchImpl);
    } else if (effectiveProviderId === "deepseek") {
      result = await fetchDeepSeekBalance(providerAuth, fetchImpl);
    } else if (effectiveProviderId === "openrouter") {
      result = await fetchOpenRouterUsage(providerAuth, effectiveProviderId, fetchImpl);
    } else if (effectiveProviderId === "anthropic") {
      result = await fetchAnthropicUsage(providerAuth, fetchImpl);
    }

    if (result) {
      const ttl = result.error ? REFRESH_COOLDOWN_MS : CACHE_TTL_MS;
      cache.set(effectiveProviderId, {
        data: result,
        expiresAt: now + ttl,
        fetchedAt: now,
      });
    } else {
      cache.delete(effectiveProviderId);
    }
    return result;
  })();

  cache.set(effectiveProviderId, {
    data: cached?.data,
    pending: request,
    expiresAt: cached?.expiresAt ?? 0,
    fetchedAt: cached?.fetchedAt ?? now,
  });

  try {
    return await request;
  } catch (error) {
    cache.delete(effectiveProviderId);
    throw error;
  }
}

export async function getAllUpstreamUsage(
  options: { forceRefresh?: boolean; auth?: AuthStorageContent; fetchImpl?: typeof fetch } = {}
): Promise<UpstreamProviderUsage[]> {
  const authData = options.auth ?? readStoredAuth();
  const supportedProviders = Object.keys(authData).filter(
    (id) =>
      id === "openai-codex" ||
      id === "deepseek" ||
      id === "openrouter" ||
      id === "anthropic"
  );

  const results = await Promise.all(
    supportedProviders.map((p) => getUpstreamProviderUsage(p, { ...options, auth: authData }))
  );

  return results.filter((r): r is UpstreamProviderUsage => r !== null);
}
