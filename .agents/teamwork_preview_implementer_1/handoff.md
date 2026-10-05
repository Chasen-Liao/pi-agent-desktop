# Progress & Handoff Report — Implementer 1

## Status: Complete

All requirements under R1, R2, and R3 have been implemented and verified.

### 1. What was changed:
- `lib/upstream-usage/types.ts`: Added structured `id?: "5h" | "7d" | string` to `UpstreamWindowUsage`.
- `lib/upstream-usage/service.ts`:
  - Increased backend cache TTL to 120s (`CACHE_TTL_MS = 120 * 1000`).
  - Added 15s cooldown debounce on manual refresh (`REFRESH_COOLDOWN_MS = 15 * 1000`), returning cached data if called within 15 seconds.
  - Added `normalizeProviderId(providerId, auth)` to map `"openai"` to `"openai-codex"` when Codex auth is present in `auth.json`.
  - Added `id: "5h"` and `id: "7d"` to windows parsed in `fetchOpenAICodexUsage` and `fetchAnthropicUsage`.
  - Supported deterministic timestamp testing via `options.now`.
- `hooks/useUpstreamUsage.ts`: Adjusted frontend polling interval from 60s to 120s (`120 * 1000`).
- `components/StatsBar.tsx`:
  - Centralized exported types `SessionStats` and `ContextUsage`.
  - Localized all tooltip strings using `lib/i18n/dictionaries.ts`.
  - Rendered Cache Write (`W`) badge alongside `↑`, `↓`, and `R`.
  - Formatted Cache Hit Rate with one decimal place (`CHxx.x%`, e.g. `CH98.9%`).
  - Formatted Context Window with 1 decimal place, no space before slash, and auto badge (`xx.x%/xxx (auto)`).
  - Added subscription badge `(sub)` when an active subscription or OAuth quota is used.
  - Eliminated primitive `.includes("5")` string matching, switching to structured `win.id === "5h"`.
- `components/UsagePopover.tsx`:
  - Reused centralized `SessionStats` and `ContextUsage` types from `StatsBar.tsx`.
  - Localized zero tokens (`t("usage.zeroTokens")`), upstream error (`t("usage.upstreamError")`), window labels (`t("usage.window5h")` / `t("usage.window7d")`), reset timing (`t("usage.resetIn")`), and gift balance (`t("usage.gift")`).
  - Eliminated hardcoded language ternaries (`langCode === "zh"`).
- `components/AppShell.tsx`: Reused `SessionStats` and `ContextUsage` types imported from `StatsBar.tsx`.
- `components/ChatWindow.tsx`: Reused `SessionStats` and `ContextUsage` types imported from `StatsBar.tsx`.
- `hooks/agent-session/session-stats.ts`: Aligned `cacheHitRate?: number | null` in `SessionStats`.
- `AGENTS.md`: Verified `__piUpstreamUsageCache` is registered in the globalThis table with 120s TTL.
- `lib/upstream-usage.test.ts`: Added tests verifying window IDs (`5h` and `7d`), provider normalization (`openai` -> `openai-codex`), rate-limit cooldown debounce (15s), and dictionary coverage.
- `components/StatsBar.test.ts`: Added tests verifying W badge rendering, 1-decimal CH%, context window format, sub badge, no `.includes("5")`, i18n keys in popover, and type centralization across AppShell/ChatWindow.

### 2. Verification:
- `npx tsc --noEmit`: Exited with 0 errors.
- `npm run lint`: Exited with 0 errors.
- `npm test`: Passed all 635 tests with `--test-force-exit`.
- `node --test --test-force-exit components/StatsBar.test.ts`: Passed all 11 tests.
- `node --test --test-force-exit lib/upstream-usage.test.ts`: Passed all 11 tests.
