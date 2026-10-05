# Adversarial Review & Fix Report (Round 2)

## 1. What the prior attempt got wrong

- **Issue 1: Displaying `$null` in StatsBar and blank `Remaining: ` in UsagePopover for unlimited OpenRouter accounts**
  - **Input:** OpenRouter API key configured without an explicit spend limit (`limit: null`, `limit_remaining: null`).
  - **Expected:** StatsBar should never display literal `$null`; UsagePopover should not render `Remaining: ` with a blank value.
  - **Actual:** Rendered `OpenRouter $null` in StatsBar; rendered `<span className="text-text-muted">Remaining: </span>` with nothing after it in UsagePopover.
  - **Root Cause:** In `components/StatsBar.tsx` and `components/UsagePopover.tsx`, the checks used `currentUsage.rawLimit?.remaining !== undefined` instead of `!= null`. Since `null !== undefined` is true, React evaluated `${null}` to string `"null"` in StatsBar.

- **Issue 2: Meaningless empty provider pill in StatsBar for pay-as-you-go accounts without quota/balance metrics**
  - **Input:** Upstream account (e.g. OpenRouter pay-as-you-go) returning neither windows nor balance, and no remaining limit.
  - **Expected:** Should not render a bare provider pill (`[OpenRouter]`) in the top bar with zero quota information or subscription badge.
  - **Actual:** The fallback condition `currentUsage.rawLimit?.remaining === undefined && !currentUsage.error` rendered `<span ...>{currentUsage.providerName}</span>` even when `isSubOrOAuth` was false.
  - **Root Cause:** Incomplete guard on fallback pill in `components/StatsBar.tsx`; it only should render if `isSubOrOAuth` is true (to show subscription status badge `(sub)`).

- **Issue 3: Erroneous `Used {percent}%` formatting in UsagePopover for dollar usage amounts**
  - **Input:** OpenRouter account with `rawLimit: { used: 150, limit: 500 }` or `limit: null`.
  - **Expected:** When `limit` is present, calculate the real used percentage (`Math.round((150 / 500) * 100) = 30%`). When `limit` is null, show cost/usage dollars rather than a meaningless percentage (`Used 150%`).
  - **Actual:** `UsagePopover.tsx` passed `percent: usage.rawLimit.used` directly into `t("usage.used", { percent: usage.rawLimit.used })`, outputting `Used 150%` or `Used 12.34%` regardless of limit.
  - **Root Cause:** In `components/UsagePopover.tsx`, `usage.rawLimit.used` (which is in USD) was treated directly as a percentage number without dividing by `limit`.

- **Issue 4: Stale error lock-in for 120 seconds on transient upstream failures**
  - **Input:** Temporary network drop, upstream 500/503 error, or 429 response during polling or manual refresh.
  - **Expected:** Subsequent requests after the 15-second cooldown debounce should retry and recover cleanly; regular polling should not be locked into an error state for 2 minutes.
  - **Actual:** In `lib/upstream-usage/service.ts`, `cache.set` assigned `expiresAt = now + CACHE_TTL_MS` (120s) unconditionally, even when `result.error` was set.
  - **Root Cause:** Lack of differentiated TTL for error results. Setting `expiresAt = now + (result.error ? REFRESH_COOLDOWN_MS : CACHE_TTL_MS)` guarantees that after the 15s cooldown debounce, requests can retry and recover immediately without waiting 120s.

- **Issue 5: `formatDuration` outputting `NaN秒` / `NaNs` on unparseable date strings**
  - **Input:** Upstream response with invalid/unparseable date string in `resets_at` (e.g. Anthropic `resets_at: "invalid"`).
  - **Expected:** Safe fallback to `"即将"` / `"now"` without emitting `NaN`.
  - **Actual:** `new Date("invalid").getTime()` returns `NaN`; `formatDuration(NaN)` fell through `seconds <= 0` and returned `"NaN秒"` / `"NaNs"`.
  - **Root Cause:** `formatDuration` lacked `!Number.isFinite(seconds)` check, and `fetchAnthropicUsage` did not validate `!isNaN(resetDate.getTime())`.

- **Issue 6: Duplicate interface definitions of `SessionStats` and `ContextUsage` in `components/StatsBar.tsx`**
  - **Input:** Codebase type definitions across `hooks/agent-session/session-stats.ts`, `lib/pi-types.ts`, and `components/StatsBar.tsx`.
  - **Expected:** Single canonical source of truth for `SessionStats` and `ContextUsage`, re-exported where needed.
  - **Actual:** `components/StatsBar.tsx` redeclared identical `export interface SessionStats` and `export interface ContextUsage` from scratch.
  - **Root Cause:** Incomplete centralization under R1. Re-exporting from canonical files (`@/hooks/agent-session/session-stats` and `@/lib/pi-types`) completely resolves duplication.

## 2. What I changed

- `components/StatsBar.tsx`:
  - Re-exported `SessionStats` and `ContextUsage` from `@/hooks/agent-session/session-stats` and `@/lib/pi-types`.
  - Replaced `remaining !== undefined` with `remaining != null` to prevent rendering `$null`.
  - Guarded fallback pill with `isSubOrOAuth` to avoid empty, useless provider pills.
  - Added label fallback resilience for `5h`, `7d`, and `Daily Free Requests`.
- `components/UsagePopover.tsx`:
  - Added label fallback resilience for `5h`, `7d`, and `Daily Free Requests`.
  - Corrected `rawLimit.used` to compute true percentage when `limit` exists, and format as cost when `limit` is not set.
  - Guarded `rawLimit.remaining != null` and formatted dollar amount.
- `lib/upstream-usage/format.ts`:
  - Guarded `formatDuration` with `!Number.isFinite(seconds) || seconds <= 0` to prevent `NaN` output.
- `lib/upstream-usage/service.ts`:
  - Cleaned up HTTP status formatting for empty `res.statusText`.
  - Enhanced AbortError / timeout detection across all fetch handlers.
  - Validated `resetDate` in `fetchAnthropicUsage`.
  - Differentiated error cache TTL (`REFRESH_COOLDOWN_MS` vs `CACHE_TTL_MS`) to eliminate stale error lock-in.
- `lib/upstream-usage.test.ts`:
  - Added test verifying transient error recovery after 15s cooldown without stale error lock-in.
  - Added test for invalid `resetDate` handling in `fetchAnthropicUsage`.
  - Added test for clean HTTP error message formatting without trailing colon.
  - Added tests for `formatDuration` robustness against `NaN`, `Infinity`, and negative values.
- `components/StatsBar.test.ts`:
  - Added test verifying canonical re-export of `SessionStats` and `ContextUsage` without duplicate interfaces.
  - Added test verifying `rawLimit.remaining != null` guard against `$null`.
  - Added test verifying `rawLimit` calculation and formatting in `UsagePopover`.
  - Added test verifying window ID/label fallback resilience.

## 3. Verification Record

- `npx tsc --noEmit`: 0 errors.
- `npm run lint`: 0 errors (6 pre-existing warnings in unrelated files).
- `node --test --test-force-exit lib/upstream-usage.test.ts components/StatsBar.test.ts`: 31 of 31 tests passed.
- `npm test`: 644 tests passed, 0 failed, 2 skipped platform-specific.
