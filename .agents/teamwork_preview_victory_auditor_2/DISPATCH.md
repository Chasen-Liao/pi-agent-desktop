## 2026-09-20T01:36:07Z
Your working directory is: d:\MyProjects\pi-agent-desktop\.agents\teamwork_preview_victory_auditor_2
Please perform an independent post-victory audit (timeline, cheating detection, independent test execution) and report your structured verdict.

<original_task>
This is a single self-contained fix; keep it small and focused.

Fix all code review issues (Standards violations & Spec mismatches) on the `dev/usage-display` branch of Pi Agent Desktop, ensuring strict i18n compliance, rate-limit safety, and full UI/UX and test consistency.

Working directory: d:\MyProjects\pi-agent-desktop
Integrity mode: demo

## Requirements

### R1. Standards & Codebase Integrity
- Eliminate all hardcoded UI/tooltip strings in `components/StatsBar.tsx`, `components/UsagePopover.tsx`, and `lib/upstream-usage/service.ts`. All user-visible strings must be in `lib/i18n/dictionaries.ts` (`en` and `zhCN`).
- Register `__piUpstreamUsageCache` in the `AGENTS.md` globalThis table.
- Eliminate data clump duplication by reusing `SessionStats` and `ContextUsage` types across `components/AppShell.tsx`, `components/ChatWindow.tsx`, and `components/StatsBar.tsx`.
- Eliminate primitive string matching (`.includes("5")`) by providing structured window IDs (`id: "5h" | "7d"`) and localization keys.

### R2. Spec & Usage Display Accuracy
- In `components/StatsBar.tsx`:
  - Render Cache Write (`W`) alongside `↑`, `↓`, and `R`.
  - Format Cache Hit Rate with one decimal place (`CHxx.x%`, e.g. `CH98.9%`).
  - Format Context Window with 1 decimal place and no spaces before slash (`xx.x%/xxx (auto)`).
  - Show subscription badge `(sub)` when an active subscription or OAuth quota is used.
- Normalize model provider IDs in `lib/upstream-usage/service.ts` so `"openai"` resolves to `"openai-codex"` when Codex auth is present.

### R3. Upstream Rate-Limit Guard & Throttling
- Increase backend cache TTL to 120s.
- Enforce a 15-second cooldown debounce on manual refresh (`forceRefresh`), returning cached data if invoked during cooldown to prevent 429 rate limit exhaustion.
- Adjust frontend polling interval to 120s.

## Acceptance Criteria

### Automated Verification
- [ ] `npx tsc --noEmit` exits with 0 errors
- [ ] `npm run lint` exits with 0 errors
- [ ] `npm test` passes all tests with `--test-force-exit`
- [ ] Automated tests verify provider normalization (`openai` -> `openai-codex`), structured window IDs, rate-limit cooldown debounce, and dictionary coverage

### Code Standards Verification
- [ ] Zero hardcoded user-visible strings in `StatsBar.tsx`, `UsagePopover.tsx`, or `service.ts`
- [ ] `__piUpstreamUsageCache` is registered in `AGENTS.md`
- [ ] `SessionStats` and `ContextUsage` types are centralized and not duplicated as raw object literals
</original_task>
