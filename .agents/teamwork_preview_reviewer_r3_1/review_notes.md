# Adversarial Reviewer Round 3 Notes

## Verification Summary
- Typecheck: npx tsc --noEmit passed (0 errors)
- Lint: npm run lint passed (0 errors, 6 pre-existing warnings in unrelated files)
- Full tests: npm test passed (648 passed, 0 failed, 2 skipped platform-specific)
- Subsystem tests: node --test --test-force-exit lib/upstream-usage.test.ts components/StatsBar.test.ts app/api/usage/upstream/route.test.ts passed (36/36 passed)

## Issues identified and resolved
1. NaN remaining / $NaN display risk in OpenAI Codex when credit balance is non-numeric or unlimited
2. NaN usedPercent risk in Anthropic five_hour / seven_day utilization when value is null or non-numeric
3. UsagePopover rawLimit.used checked with !== undefined instead of != null, risking $null cost display
4. UsagePopover rawLimit rendering empty border-t container when both used and remaining are null
5. UsagePopover planType badge using non-standard Tailwind class py-0.2 instead of py-0.5
6. Multi-provider display in UsagePopover shadowed when providerId is null
7. formatDuration float seconds formatting without flooring
8. Missing route test for forceRefresh query param and cooldown debounce
9. docs/ARCHITECTURE.md globalThis table missing __piUpstreamUsageCache entry
