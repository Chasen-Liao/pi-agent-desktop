import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchOpenAICodexUsage,
  fetchDeepSeekBalance,
  fetchOpenRouterUsage,
  fetchAnthropicUsage,
  getUpstreamProviderUsage,
  normalizeProviderId,
  CACHE_TTL_MS,
  REFRESH_COOLDOWN_MS,
} from "./upstream-usage/service.ts";
import { formatDuration } from "./upstream-usage/format.ts";
import { en, zhCN } from "./i18n/dictionaries.ts";

test("fetchOpenAICodexUsage parses 5h and 7d windows from wham/usage", async () => {
  const mockFetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        plan_type: "plus",
        rate_limit: {
          primary_window: {
            used_percent: 4.2,
            limit_window_seconds: 18000,
            reset_after_seconds: 16200,
            reset_at: 1789817024,
          },
          secondary_window: {
            used_percent: 41.8,
            limit_window_seconds: 604800,
            reset_after_seconds: 324000,
            reset_at: 1789826626,
          },
        },
        credits: {
          balance: "10.5",
        },
      }),
    } as unknown as Response;
  };

  const usage = await fetchOpenAICodexUsage(
    { access: "mock-token", accountId: "acc-123" },
    mockFetch as unknown as typeof fetch
  );

  assert.equal(usage.provider, "openai-codex");
  assert.equal(usage.planType, "plus");
  assert.equal(usage.windows?.length, 2);
  assert.equal(usage.windows?.[0].id, "5h");
  assert.equal(usage.windows?.[0].label, "5h");
  assert.equal(usage.windows?.[0].usedPercent, 4);
  assert.equal(usage.windows?.[0].resetAfterSeconds, 16200);
  assert.equal(usage.windows?.[1].id, "7d");
  assert.equal(usage.windows?.[1].label, "7d");
  assert.equal(usage.windows?.[1].usedPercent, 42);
  assert.equal(usage.rawLimit?.remaining, 10.5);
});

test("fetchOpenAICodexUsage handles missing access token", async () => {
  const usage = await fetchOpenAICodexUsage({});
  assert.equal(usage.provider, "openai-codex");
  assert.ok(usage.error?.includes("No access token"));
});

test("fetchDeepSeekBalance parses balance infos", async () => {
  const mockFetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        is_available: true,
        balance_infos: [
          { currency: "CNY", total_balance: "50.00", granted_balance: "10.00", topped_up_balance: "40.00" },
          { currency: "USD", total_balance: "0.00" },
        ],
      }),
    } as unknown as Response;
  };

  const usage = await fetchDeepSeekBalance({ key: "sk-mock" }, mockFetch as unknown as typeof fetch);
  assert.equal(usage.provider, "deepseek");
  assert.equal(usage.balance?.length, 2);
  assert.equal(usage.balance?.[0].currency, "CNY");
  assert.equal(usage.balance?.[0].total, "50.00");
  assert.equal(usage.balance?.[0].granted, "10.00");
});

test("fetchOpenRouterUsage parses daily free requests and limits", async () => {
  const mockFetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          label: "my-key",
          usage: 12.34,
          limit: 100,
          limit_remaining: 87.66,
          is_free_tier: true,
          free_model_daily_requests: {
            used: 15,
            limit: 50,
            remaining: 35,
          },
        },
      }),
    } as unknown as Response;
  };

  const usage = await fetchOpenRouterUsage({ key: "sk-or-mock" }, "openrouter", mockFetch as unknown as typeof fetch);
  assert.equal(usage.provider, "openrouter");
  assert.equal(usage.planType, "Free Tier");
  assert.equal(usage.rawLimit?.used, 12.34);
  assert.equal(usage.windows?.[0].id, "daily_free");
  assert.equal(usage.windows?.[0].label, "Daily Free Requests");
  assert.equal(usage.windows?.[0].usedPercent, 30);
});

test("fetchAnthropicUsage parses 5h and 7d utilization", async () => {
  const mockFetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        five_hour: { utilization: 0.15, resets_at: "2026-09-19T20:00:00.000Z" },
        seven_day: { utilization: 0.55, resets_at: "2026-09-25T00:00:00.000Z" },
      }),
    } as unknown as Response;
  };

  const usage = await fetchAnthropicUsage({ access: "token-claude" }, mockFetch as unknown as typeof fetch);
  assert.equal(usage.provider, "anthropic");
  assert.equal(usage.windows?.length, 2);
  assert.equal(usage.windows?.[0].id, "5h");
  assert.equal(usage.windows?.[0].label, "5h");
  assert.equal(usage.windows?.[0].usedPercent, 15);
  assert.equal(usage.windows?.[1].id, "7d");
  assert.equal(usage.windows?.[1].label, "7d");
  assert.equal(usage.windows?.[1].usedPercent, 55);
});

test("getUpstreamProviderUsage uses in-memory cache and honors forceRefresh", async () => {
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        plan_type: "plus",
        rate_limit: {
          primary_window: { used_percent: 10, reset_after_seconds: 3600 },
        },
      }),
    } as unknown as Response;
  };

  const mockAuth = {
    "openai-codex": { access: "tok-1" },
  };

  const t0 = 100_000;
  // First call -> fetch
  const res1 = await getUpstreamProviderUsage("openai-codex", {
    auth: mockAuth,
    fetchImpl: mockFetch as unknown as typeof fetch,
    now: t0,
  });
  assert.equal(fetchCount, 1);
  assert.equal(res1?.windows?.[0].usedPercent, 10);

  // Second call without forceRefresh within TTL -> cached!
  const res2 = await getUpstreamProviderUsage("openai-codex", {
    auth: mockAuth,
    fetchImpl: mockFetch as unknown as typeof fetch,
    now: t0 + 5000,
  });
  assert.equal(fetchCount, 1);
  assert.equal(res2?.windows?.[0].usedPercent, 10);

  // Third call with forceRefresh within 15s cooldown -> cooldown debounced, returns cached data!
  const res3 = await getUpstreamProviderUsage("openai-codex", {
    auth: mockAuth,
    forceRefresh: true,
    fetchImpl: mockFetch as unknown as typeof fetch,
    now: t0 + 10_000, // 10s elapsed < 15s cooldown
  });
  assert.equal(fetchCount, 1);
  assert.equal(res3?.windows?.[0].usedPercent, 10);

  // Fourth call with forceRefresh after 15s cooldown -> refetches!
  const res4 = await getUpstreamProviderUsage("openai-codex", {
    auth: mockAuth,
    forceRefresh: true,
    fetchImpl: mockFetch as unknown as typeof fetch,
    now: t0 + 16_000, // 16s elapsed >= 15s cooldown
  });
  assert.equal(fetchCount, 2);
  assert.equal(res4?.windows?.[0].usedPercent, 10);
});

test("normalizeProviderId resolves openai to openai-codex when Codex auth is present", () => {
  const authWithCodex = {
    "openai-codex": { access: "token-123" },
  };
  const authWithoutCodex = {
    openai: { key: "sk-openai" },
  };

  assert.equal(normalizeProviderId("openai", authWithCodex), "openai-codex");
  assert.equal(normalizeProviderId("openai", authWithoutCodex), "openai");
  assert.equal(normalizeProviderId("deepseek", authWithCodex), "deepseek");
  assert.equal(normalizeProviderId("anthropic", authWithCodex), "anthropic");
});

test("getUpstreamProviderUsage normalizes openai to openai-codex when fetching", async () => {
  const mockFetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        plan_type: "plus",
        rate_limit: {
          primary_window: { used_percent: 5 },
        },
      }),
    } as unknown as Response;
  };

  const authWithCodex = {
    "openai-codex": { access: "tok-codex" },
  };

  const usage = await getUpstreamProviderUsage("openai", {
    auth: authWithCodex,
    fetchImpl: mockFetch as unknown as typeof fetch,
  });

  assert.ok(usage);
  assert.equal(usage?.provider, "openai-codex");
  assert.equal(usage?.providerName, "OpenAI Codex");
});

test("constants verify 120s TTL and 15s cooldown debounce", () => {
  assert.equal(CACHE_TTL_MS, 120 * 1000);
  assert.equal(REFRESH_COOLDOWN_MS, 15 * 1000);
});

test("dictionary coverage: en and zhCN both contain all usage keys", () => {
  const enKeys = Object.keys(en).filter((k) => k.startsWith("usage."));
  const zhKeys = Object.keys(zhCN).filter((k) => k.startsWith("usage."));

  assert.ok(enKeys.length > 15, "Expected multiple usage keys in dictionary");
  assert.deepEqual(enKeys.sort(), zhKeys.sort(), "All usage keys must exist in both en and zhCN");

  // Specific required keys:
  const expectedKeys = [
    "usage.title",
    "usage.sessionTitle",
    "usage.upstreamTitle",
    "usage.input",
    "usage.output",
    "usage.cacheRead",
    "usage.cacheWrite",
    "usage.cacheHitRate",
    "usage.totalTokens",
    "usage.cost",
    "usage.contextWindow",
    "usage.contextUsed",
    "usage.autoCompact",
    "usage.upstreamRateLimit",
    "usage.used",
    "usage.resetIn",
    "usage.resetAt",
    "usage.balance",
    "usage.remaining",
    "usage.refresh",
    "usage.refreshing",
    "usage.noUpstream",
    "usage.upstreamError",
    "usage.gift",
    "usage.zeroTokens",
    "usage.sub",
    "usage.auto",
    "usage.window5h",
    "usage.window7d",
    "usage.windowDailyFree",
    "usage.dailyFree",
    "usage.tooltip.in",
    "usage.tooltip.out",
    "usage.tooltip.cacheRead",
    "usage.tooltip.cacheWrite",
    "usage.tooltip.cacheHit",
    "usage.tooltip.cost",
    "usage.tooltip.context",
    "usage.tooltip.quota",
  ];

  for (const key of expectedKeys) {
    assert.ok(key in en, `Missing key in en: ${key}`);
    assert.ok(key in zhCN, `Missing key in zhCN: ${key}`);
  }
});

test("zero hardcoded Chinese strings in lib/upstream-usage/service.ts", async () => {
  const { readFileSync } = await import("node:fs");
  const serviceSource = readFileSync(new URL("./upstream-usage/service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(serviceSource, /5小时/);
  assert.doesNotMatch(serviceSource, /7天/);
  assert.doesNotMatch(serviceSource, /每日免费请求/);
});

test("formatDuration formats seconds into human readable text", () => {
  assert.equal(formatDuration(16200, "zh"), "4小时30分");
  assert.equal(formatDuration(16200, "en"), "4h 30m");
  assert.equal(formatDuration(324000, "zh"), "3天18小时");
  assert.equal(formatDuration(324000, "en"), "3d 18h");
  assert.equal(formatDuration(3600, "zh"), "1小时");
  assert.equal(formatDuration(3600, "en"), "1h");
  assert.equal(formatDuration(120, "zh"), "2分钟");
  assert.equal(formatDuration(120, "en"), "2m");
  assert.equal(formatDuration(45, "zh"), "45秒");
  assert.equal(formatDuration(0, "zh"), "即将");
  // Non-finite and negative inputs fallback safely to now/即将 instead of NaN
  assert.equal(formatDuration(NaN, "zh"), "即将");
  assert.equal(formatDuration(NaN, "en"), "now");
  assert.equal(formatDuration(Infinity, "zh"), "即将");
  assert.equal(formatDuration(-10, "en"), "now");
});

test("fetchAnthropicUsage handles invalid resetDate without producing NaN", async () => {
  const mockFetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        five_hour: { utilization: 0.2, resets_at: "not-a-valid-date" },
      }),
    } as unknown as Response;
  };

  const usage = await fetchAnthropicUsage({ access: "tok" }, mockFetch as unknown as typeof fetch);
  assert.equal(usage.windows?.[0].usedPercent, 20);
  assert.equal(usage.windows?.[0].resetAfterSeconds, undefined);
  assert.equal(usage.windows?.[0].resetAt, undefined);
});

test("fetchOpenAICodexUsage formats HTTP error cleanly when statusText is empty", async () => {
  const mockFetch = async () => {
    return {
      ok: false,
      status: 500,
      statusText: "",
    } as unknown as Response;
  };

  const usage = await fetchOpenAICodexUsage({ access: "tok" }, mockFetch as unknown as typeof fetch);
  assert.equal(usage.error, "HTTP 500");
});

test("getUpstreamProviderUsage recovers from transient error after 15s cooldown without stale error lock-in", async () => {
  let attempt = 0;
  const mockFetch = async () => {
    attempt++;
    if (attempt === 1) {
      return {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        plan_type: "plus",
        rate_limit: {
          primary_window: { used_percent: 25 },
        },
      }),
    } as unknown as Response;
  };

  const mockAuth = {
    "openai-codex": { access: "tok-recovery" },
  };

  globalThis.__piUpstreamUsageCache?.clear();
  const t0 = 200_000;
  // 1. First fetch fails with 503
  const res1 = await getUpstreamProviderUsage("openai-codex", {
    auth: mockAuth,
    fetchImpl: mockFetch as unknown as typeof fetch,
    now: t0,
    forceRefresh: true,
  });
  assert.equal(attempt, 1);
  assert.equal(res1?.error, "HTTP 503: Service Unavailable");

  // 2. Call within 15s cooldown debounces and returns cached error
  const res2 = await getUpstreamProviderUsage("openai-codex", {
    auth: mockAuth,
    fetchImpl: mockFetch as unknown as typeof fetch,
    now: t0 + 5000,
    forceRefresh: true,
  });
  assert.equal(attempt, 1);
  assert.equal(res2?.error, "HTTP 503: Service Unavailable");

  // 3. Call after 15s cooldown (t0 + 16s) refetches and recovers to success
  const res3 = await getUpstreamProviderUsage("openai-codex", {
    auth: mockAuth,
    fetchImpl: mockFetch as unknown as typeof fetch,
    now: t0 + 16_000,
    forceRefresh: true,
  });
  assert.equal(attempt, 2);
  assert.equal(res3?.error, undefined);
  assert.equal(res3?.windows?.[0].usedPercent, 25);

  // 4. Regular fetch within 120s TTL keeps the successful cached result
  const res4 = await getUpstreamProviderUsage("openai-codex", {
    auth: mockAuth,
    fetchImpl: mockFetch as unknown as typeof fetch,
    now: t0 + 30_000,
    forceRefresh: false,
  });
  assert.equal(attempt, 2);
  assert.equal(res4?.windows?.[0].usedPercent, 25);
});

test("fetchOpenAICodexUsage handles non-numeric credit balance without producing NaN", async () => {
  const mockFetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        plan_type: "team",
        rate_limit: {
          primary_window: { used_percent: null },
        },
        credits: {
          balance: "unlimited",
          unlimited: true,
        },
      }),
    } as unknown as Response;
  };

  const usage = await fetchOpenAICodexUsage({ access: "tok-unlimited" }, mockFetch as unknown as typeof fetch);
  assert.equal(usage.rawLimit?.remaining, undefined);
  assert.equal(usage.windows?.[0].usedPercent, 0);
});

test("fetchAnthropicUsage handles null and non-numeric utilization safely", async () => {
  const mockFetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        five_hour: { utilization: null },
        seven_day: { utilization: "invalid" as unknown as number },
      }),
    } as unknown as Response;
  };

  const usage = await fetchAnthropicUsage({ access: "tok-null" }, mockFetch as unknown as typeof fetch);
  assert.equal(usage.windows?.length, 0);
});

test("formatDuration handles float seconds by flooring", () => {
  assert.equal(formatDuration(45.8, "zh"), "45秒");
  assert.equal(formatDuration(45.8, "en"), "45s");
  assert.equal(formatDuration(120.9, "zh"), "2分钟");
  assert.equal(formatDuration(120.9, "en"), "2m");
});


