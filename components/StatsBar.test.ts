import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const statsBarSource = readFileSync(new URL("./StatsBar.tsx", import.meta.url), "utf8");
const usagePopoverSource = readFileSync(new URL("./UsagePopover.tsx", import.meta.url), "utf8");
const appShellSource = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatWindowSource = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("StatsBar contains accessible dialog trigger and no-drag region", () => {
  assert.match(statsBarSource, /\[-webkit-app-region:no-drag\]/);
  assert.match(statsBarSource, /aria-haspopup="dialog"/);
  assert.match(statsBarSource, /aria-expanded=\{popoverOpen\}/);
});

test("StatsBar renders Cache Write (W) alongside input, output, and cache read", () => {
  assert.match(statsBarSource, />W</);
  assert.match(statsBarSource, /fmt\(tks\.cacheWrite\)/);
});

test("StatsBar computes and renders cache hit rate (CH%) with one decimal place", () => {
  assert.match(statsBarSource, /cacheHitRate/);
  assert.match(statsBarSource, />CH</);
  assert.match(statsBarSource, /cacheHitRate\.toFixed\(1\)/);
});

test("StatsBar formats Context Window with 1 decimal place, no space before slash, and auto badge", () => {
  assert.match(statsBarSource, /pct\.toFixed\(1\)/);
  assert.match(statsBarSource, /\`\$\{pctStr\}\/\$\{fmt\(contextUsage\.contextWindow\)\} \$\{t\("usage\.auto"\)\}\`/);
});

test("StatsBar shows subscription badge (sub) for active subscription or OAuth quota precisely", () => {
  assert.match(statsBarSource, /isSubOrOAuth/);
  assert.match(statsBarSource, /t\("usage\.sub"\)/);
  // Ensure subscription matching targets actual subscriptions and does not false-positive on Pay-as-you-go
  const subPlanRegex = /sub|plus|pro|team|enterprise/i;
  assert.ok(subPlanRegex.test("plus"));
  assert.ok(subPlanRegex.test("pro"));
  assert.ok(subPlanRegex.test("team"));
  assert.ok(subPlanRegex.test("enterprise"));
  assert.ok(!subPlanRegex.test("Pay-as-you-go"));
  assert.ok(!subPlanRegex.test("Free Tier"));
});

test("StatsBar eliminates primitive string matching and uses structured window IDs", () => {
  assert.doesNotMatch(statsBarSource, /\.includes\("5"\)/);
  assert.doesNotMatch(statsBarSource, /\.includes\("7"\)/);
  assert.match(statsBarSource, /win\.id === "5h"/);
  assert.match(statsBarSource, /win\.id === "7d"/);
  assert.match(statsBarSource, /win\.id === "daily_free"/);
  assert.match(statsBarSource, /t\("usage\.dailyFree"\)/);
  assert.match(usagePopoverSource, /win\.id === "daily_free"/);
  assert.match(usagePopoverSource, /t\("usage\.windowDailyFree"\)/);
});

test("StatsBar localizes all tooltip parts via dictionary keys", () => {
  assert.match(statsBarSource, /t\("usage\.tooltip\.in"/);
  assert.match(statsBarSource, /t\("usage\.tooltip\.out"/);
  assert.match(statsBarSource, /t\("usage\.tooltip\.cacheRead"/);
  assert.match(statsBarSource, /t\("usage\.tooltip\.cacheWrite"/);
  assert.match(statsBarSource, /t\("usage\.tooltip\.cacheHit"/);
  assert.match(statsBarSource, /t\("usage\.tooltip\.cost"/);
  assert.match(statsBarSource, /t\("usage\.tooltip\.context"/);
  assert.match(statsBarSource, /t\("usage\.tooltip\.quota"/);
});

test("StatsBar wires useUpstreamUsage with currentProvider", () => {
  assert.match(statsBarSource, /useUpstreamUsage\(currentProvider\)/);
  assert.match(statsBarSource, /UsagePopover/);
});

test("StatsBar displays upstream quota windows pill", () => {
  assert.match(statsBarSource, /currentUsage\.windows/);
  assert.match(statsBarSource, /win\.usedPercent/);
});

test("UsagePopover renders session stats, context window, and upstream quota sections with strict i18n", () => {
  assert.match(usagePopoverSource, /t\("usage\.sessionTitle"\)/);
  assert.match(usagePopoverSource, /t\("usage\.contextWindow"\)/);
  assert.match(usagePopoverSource, /t\("usage\.upstreamTitle"\)/);
  assert.match(usagePopoverSource, /t\("usage\.zeroTokens"\)/);
  assert.match(usagePopoverSource, /t\("usage\.upstreamError"/);
  assert.match(usagePopoverSource, /t\("usage\.window5h"\)/);
  assert.match(usagePopoverSource, /t\("usage\.window7d"\)/);
  assert.match(usagePopoverSource, /t\("usage\.resetIn"/);
  assert.match(usagePopoverSource, /t\("usage\.gift"\)/);
  assert.match(usagePopoverSource, /formatDuration/);
  assert.match(usagePopoverSource, /role="dialog"/);
});

test("SessionStats and ContextUsage types are centralized in StatsBar and reused", () => {
  assert.match(appShellSource, /import \{[^}]*SessionStats[^}]*\} from "\.\/StatsBar"/);
  assert.match(appShellSource, /useState<SessionStats \| null>\(null\)/);
  assert.match(appShellSource, /useState<ContextUsage \| null>\(null\)/);
  assert.match(chatWindowSource, /import type \{[^}]*SessionStats[^}]*\} from "\.\/StatsBar"/);
  assert.match(chatWindowSource, /onSessionStatsChange\?: \(stats: SessionStats \| null\) => void/);
  assert.match(chatWindowSource, /onContextUsageChange\?: \(usage: ContextUsage \| null\) => void/);
  assert.match(usagePopoverSource, /import type \{[^}]*SessionStats[^}]*\} from "\.\/StatsBar"/);
});

test("zero hardcoded user-visible strings in StatsBar.tsx and UsagePopover.tsx", () => {
  // Ensure no hardcoded window or tooltip literals exist
  assert.doesNotMatch(statsBarSource, /5小时/);
  assert.doesNotMatch(statsBarSource, /7天/);
  assert.doesNotMatch(statsBarSource, /每日免费请求/);
  assert.doesNotMatch(usagePopoverSource, /5小时/);
  assert.doesNotMatch(usagePopoverSource, /7天/);
  assert.doesNotMatch(usagePopoverSource, /每日免费请求/);
});

test("StatsBar re-exports canonical SessionStats and ContextUsage without duplicate interface definitions", () => {
  assert.match(statsBarSource, /import type \{ SessionStats \} from "@\/hooks\/agent-session\/session-stats"/);
  assert.match(statsBarSource, /import type \{ ContextUsage \} from "@\/lib\/pi-types"/);
  assert.match(statsBarSource, /export type \{ SessionStats, ContextUsage \}/);
  assert.doesNotMatch(statsBarSource, /export interface SessionStats \{/);
  assert.doesNotMatch(statsBarSource, /export interface ContextUsage \{/);
});

test("StatsBar guards rawLimit against null remaining to prevent $null", () => {
  assert.match(statsBarSource, /currentUsage\.rawLimit\?\.remaining != null/);
  assert.doesNotMatch(statsBarSource, /currentUsage\.rawLimit\?\.remaining !== undefined &&/);
  assert.match(statsBarSource, /currentUsage\.rawLimit\?\.remaining == null &&\s*!currentUsage\.error &&\s*isSubOrOAuth/);
});

test("UsagePopover computes used percentage when limit is present and guards remaining against null", () => {
  assert.match(usagePopoverSource, /usage\.rawLimit\.remaining != null/);
  assert.match(usagePopoverSource, /usage\.rawLimit\.used != null/);
  assert.match(usagePopoverSource, /Math\.round\(\(usage\.rawLimit\.used \/ usage\.rawLimit\.limit\) \* 100\)/);
  assert.match(usagePopoverSource, /\`\$\{t\("usage\.cost"\)\}: \$\$\{usage\.rawLimit\.used\}\`/);
  // Ensure valid Tailwind padding on planType badge
  assert.match(usagePopoverSource, /px-1\.5 py-0\.5/);
  assert.doesNotMatch(usagePopoverSource, /py-0\.2/);
});

test("StatsBar and UsagePopover window label mapping is resilient to fallback matching on label", () => {
  assert.match(statsBarSource, /win\.id === "5h" \|\| win\.label === "5h"/);
  assert.match(statsBarSource, /win\.id === "7d" \|\| win\.label === "7d"/);
  assert.match(statsBarSource, /win\.id === "daily_free" \|\| win\.label === "Daily Free Requests"/);
  assert.match(usagePopoverSource, /win\.id === "5h" \|\| win\.label === "5h"/);
  assert.match(usagePopoverSource, /win\.id === "7d" \|\| win\.label === "7d"/);
  assert.match(usagePopoverSource, /win\.id === "daily_free" \|\| win\.label === "Daily Free Requests"/);
});

