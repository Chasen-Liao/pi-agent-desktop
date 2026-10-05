# Adversarial Reviewer Round 1 Report

## Summary of Findings & Actions
1. **Hardcoded Strings in `lib/upstream-usage/service.ts`**:
   - `label: "5小时"`, `label: "7天"`, `label: "每日免费请求"` were hardcoded Chinese literals in the backend service.
   - OpenRouter's free request window had no `id` (`win.id` was undefined), causing `UsagePopover` to display `"每日免费请求"` in English mode, and `StatsBar` to show `"每日免费请求: 30%"` in the compact pill.
   - Fixed: Added structured `id: "daily_free"`, replaced labels with neutral/fallback values (`"5h"`, `"7d"`, `"Daily Free Requests"`), added `"usage.windowDailyFree"` and `"usage.dailyFree"` to `dictionaries.ts` for both `en` and `zhCN`.
2. **False Positive `(sub)` Subscription Badge for OpenRouter Pay-as-you-go**:
   - `isSubOrOAuth` used `!/free/i.test(currentUsage.planType)`, which incorrectly treated `"Pay-as-you-go"` as a subscription (`(sub)` / `(订阅)`).
   - Fixed: Changed to explicit `/sub|plus|pro|team|enterprise/i.test(planType)`.
3. **Colon Formatting Glitch in StatsBar Balance Pill**:
   - Provider name had a colon right before the `(sub)` badge (`OpenAI Codex: (sub) $10.00`).
   - Fixed: Removed colon before badge to match the windows pill formatting.
4. **Missing Upstream Quota Pill for Accounts with `rawLimit` Only**:
   - StatsBar only checked `windows.length > 0` or `balance.length > 0`. Accounts with only `rawLimit` (like OpenRouter pay-as-you-go) showed nothing.
   - Fixed: Added fallback rendering for `rawLimit?.remaining` in `StatsBar.tsx`.
5. **Testing**:
   - All 637 automated tests pass cleanly with `--test-force-exit`.
   - `npx tsc --noEmit` and `npm run lint` pass with 0 errors.
