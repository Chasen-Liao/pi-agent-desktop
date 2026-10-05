# Implementation Plan: Fix Code Review Issues on dev/usage-display

## Overview
Address all Standards violations and Spec mismatches on branch `dev/usage-display`:
1. R1: Standards & Codebase Integrity
   - Centralize `SessionStats` and `ContextUsage` types in `components/StatsBar.tsx` and reuse in `components/AppShell.tsx`, `components/ChatWindow.tsx`, and `components/UsagePopover.tsx`.
   - Ensure `__piUpstreamUsageCache` is registered in `AGENTS.md` globalThis table.
   - Eliminate primitive `.includes("5")` matching with structured `id: "5h" | "7d"` on window usages.
   - Eliminate hardcoded strings in `StatsBar.tsx`, `UsagePopover.tsx`, and `lib/upstream-usage/service.ts`, routing all user-visible text through `lib/i18n/dictionaries.ts`.
2. R2: Spec & Usage Display Accuracy
   - In `StatsBar.tsx`: Render Cache Write (`W`), format Cache Hit Rate as `CHxx.x%` (`toFixed(1)`), format Context Window as `xx.x%/xxx (auto)` (`toFixed(1)`, no space around slash, localized `(auto)`), show subscription badge `(sub)`.
   - Normalize provider ID `openai` -> `openai-codex` when Codex auth is present.
3. R3: Upstream Rate-Limit Guard & Throttling
   - Backend cache TTL = 120s.
   - 15s cooldown debounce on manual refresh (`forceRefresh`).
   - Frontend polling interval = 120s in `useUpstreamUsage.ts`.
4. Automated Verification & Testing
   - Update and add unit tests in `lib/upstream-usage.test.ts` and `components/StatsBar.test.ts`.
   - Run `npx tsc --noEmit`, `npm run lint`, and `npm test`.
