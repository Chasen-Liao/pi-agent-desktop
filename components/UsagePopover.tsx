"use client";

import React, { useEffect, useState } from "react";
import { useI18n } from "./I18nProvider";
import type { UpstreamProviderUsage } from "@/lib/upstream-usage/types";
import { formatDuration } from "@/lib/upstream-usage/format";

import type { SessionStats, ContextUsage } from "./StatsBar";

export type SessionStatsProps = SessionStats;
export type ContextUsageProps = ContextUsage;

export interface UsagePopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRect: DOMRect | null;
  sessionStats?: SessionStats | null;
  contextUsage?: ContextUsage | null;
  upstreamUsage?: UpstreamProviderUsage | null;
  allUsages?: UpstreamProviderUsage[];
  loading?: boolean;
  onRefresh?: () => void;
}

export function UsagePopover({
  open,
  onClose,
  anchorRect,
  sessionStats = null,
  contextUsage = null,
  upstreamUsage = null,
  allUsages = [],
  loading = false,
  onRefresh,
}: UsagePopoverProps) {
  const { t, locale } = useI18n();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  if (!open || !anchorRect) return null;

  const top = anchorRect.bottom + 6;
  const right = Math.max(12, window.innerWidth - anchorRect.right);
  const viewportHeight = typeof window !== "undefined" ? (window.visualViewport?.height ?? window.innerHeight) : 800;
  const maxH = Math.max(200, Math.min(520, viewportHeight - top - 16));

  const tks = sessionStats?.tokens;
  const c = sessionStats?.cost ?? 0;
  const costStr = c > 0 ? (c >= 0.01 ? `$${c.toFixed(4)}` : `<$0.01`) : "$0.00";
  const hitRate =
    sessionStats?.cacheHitRate != null && Number.isFinite(sessionStats.cacheHitRate)
      ? `${sessionStats.cacheHitRate.toFixed(1)}%`
      : tks && (tks.input + tks.cacheRead + tks.cacheWrite > 0)
      ? `${((tks.cacheRead / (tks.input + tks.cacheRead + tks.cacheWrite)) * 100).toFixed(1)}%`
      : "-";

  const ctxPct = contextUsage?.percent;
  const ctxWindow = contextUsage?.contextWindow ?? 0;
  const ctxTokens = contextUsage?.tokens ?? 0;

  // Decide which upstream usages to show (primary active one, or all available)
  const displayUsages = upstreamUsage
    ? [upstreamUsage]
    : allUsages.length > 0
    ? allUsages
    : [];

  const durationLocale = locale.startsWith("zh") ? "zh" : "en";
  const localizeUpstreamError = (error: string) => {
    if (/timeout|abort|cancel/i.test(error)) return t("usage.errorTimeout");
    if (/no (access token|api key)/i.test(error)) return t("usage.errorCredentials");
    if (/^HTTP \d+/i.test(error)) return t("usage.errorRejected");
    return t("usage.errorUnknown");
  };

  return (
    <div
      role="dialog"
      aria-label={t("usage.title")}
      className="t-dropdown is-open material-popover fixed z-[700] w-[350px] rounded-panel border border-border p-3.5 shadow-popover text-text select-none flex flex-col"
      data-origin="top-right"
      style={{ top, right, maxHeight: maxH }}
    >
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 font-semibold text-[13px] text-text-strong">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          <span>{t("usage.title")}</span>
        </div>
        <div className="flex items-center gap-0.5">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              title={t("usage.refresh")}
              className="flex h-6 w-6 items-center justify-center rounded-control text-text-muted hover:bg-bg-hover hover:text-text transition-colors duration-150 disabled:opacity-40 cursor-pointer border-none bg-transparent"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={loading ? "animate-spin text-accent" : ""}
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-control text-text-muted hover:bg-bg-hover hover:text-text transition-colors duration-150 cursor-pointer border-none bg-transparent"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="h-px bg-divider -mx-3.5 my-2.5 shrink-0" />

      <div className="space-y-3.5 overflow-y-auto pr-0.5 flex-1 min-h-0 text-[11px]">
        {/* Section 1: Session Token Usage */}
        <div>
          <div className="text-[10px] font-semibold text-text-dim uppercase tracking-wider mb-1.5">
            {t("usage.sessionTitle")}
          </div>
          {tks ? (
            <div className="grid grid-cols-2 gap-2 rounded-control border border-border bg-bg-panel/60 p-2.5">
              <div>
                <div className="text-[10px] text-text-dim flex items-center gap-1">
                  <span className="text-accent font-bold">↑</span>
                  <span>{t("usage.input")}</span>
                </div>
                <div className="font-mono text-text font-medium mt-0.5 text-[12px]">{tks.input.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-dim flex items-center gap-1">
                  <span className="text-info font-bold">↓</span>
                  <span>{t("usage.output")}</span>
                </div>
                <div className="font-mono text-text font-medium mt-0.5 text-[12px]">{tks.output.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-dim flex items-center gap-1">
                  <span className="text-success font-bold">R</span>
                  <span>{t("usage.cacheRead")}</span>
                </div>
                <div className="font-mono text-text font-medium mt-0.5 text-[12px]">{tks.cacheRead.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-dim flex items-center gap-1">
                  <span className="text-warning font-bold">W</span>
                  <span>{t("usage.cacheWrite")}</span>
                </div>
                <div className="font-mono text-text font-medium mt-0.5 text-[12px]">{tks.cacheWrite.toLocaleString()}</div>
              </div>
              <div className="pt-2 border-t border-divider">
                <div className="text-[10px] text-text-dim">{t("usage.cacheHitRate")}</div>
                <div className="font-mono text-success font-semibold mt-0.5 text-[12px]">{hitRate}</div>
              </div>
              <div className="pt-2 border-t border-divider">
                <div className="text-[10px] text-text-dim">{t("usage.cost")}</div>
                <div className="font-mono text-text font-semibold mt-0.5 text-[12px]">{costStr}</div>
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-text-muted italic py-2 px-3 rounded-control border border-border bg-bg-panel/50">
              {t("usage.zeroTokens")}
            </div>
          )}
        </div>

        {/* Section 2: Context Window */}
        {ctxWindow > 0 && (
          <div>
            <div className="flex items-center justify-between text-[10px] font-semibold text-text-dim uppercase tracking-wider mb-1.5">
              <span>{t("usage.contextWindow")}</span>
              <span className="font-mono text-text-muted font-normal text-[10px]">
                {ctxTokens.toLocaleString()} / {ctxWindow.toLocaleString()}
              </span>
            </div>
            <div className="space-y-1.5 rounded-control border border-border bg-bg-panel/60 p-2.5">
              <div className="w-full h-2 rounded-full bg-bg-elevated border border-border-subtle overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.min(100, Math.max(0, ctxPct ?? 0))}%`,
                    backgroundColor:
                      (ctxPct ?? 0) > 90
                        ? "var(--danger)"
                        : (ctxPct ?? 0) > 70
                        ? "var(--warning)"
                        : "var(--accent)",
                  }}
                />
              </div>
              <div className="flex justify-between items-center text-[10px] text-text-dim font-mono">
                <span>{ctxPct != null ? `${ctxPct.toFixed(1)}%` : "?"}</span>
                <span className="font-sans text-text-muted">{t("usage.autoCompact")}</span>
              </div>
            </div>
          </div>
        )}

        {/* Section 3: Upstream Provider Quota */}
        <div>
          <div className="text-[10px] font-semibold text-text-dim uppercase tracking-wider mb-1.5">
            {t("usage.upstreamTitle")}
          </div>

          {loading && displayUsages.length === 0 ? (
            <div className="flex items-center justify-center py-4 text-text-muted text-[11px] gap-2 rounded-control border border-border bg-bg-panel/50">
              <svg className="animate-spin h-3.5 w-3.5 text-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>{t("usage.refreshing")}</span>
            </div>
          ) : displayUsages.length === 0 ? (
            <div className="text-[11px] text-text-muted py-2 px-3 bg-bg-panel/50 rounded-control border border-border">
              {t("usage.noUpstream")}
            </div>
          ) : (
            <div className="space-y-2.5">
              {displayUsages.map((usage) => (
                <div
                  key={usage.provider}
                  className="bg-bg-panel/60 p-2.5 rounded-control border border-border space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text text-[12px]">{usage.providerName}</span>
                    {usage.planType && (
                      <span className="text-[10px] font-mono font-medium uppercase px-1.5 py-0.5 bg-accent/10 text-accent rounded-control border border-accent/20">
                        {usage.planType}
                      </span>
                    )}
                  </div>

                  {usage.error && (
                    <div className="text-[11px] text-danger bg-danger-bg p-2 rounded-control border border-danger-border">
                      {t("usage.upstreamError", { error: localizeUpstreamError(usage.error) })}
                    </div>
                  )}

                  {/* Rate Limit Windows (5h / 7d) */}
                  {usage.windows && usage.windows.length > 0 && (
                    <div className="space-y-2 pt-0.5">
                      {usage.windows.map((win, idx) => {
                        const pct = win.usedPercent;
                        const resetSeconds =
                          win.resetAt != null
                            ? Math.max(0, Math.ceil((win.resetAt - now) / 1000))
                            : win.resetAfterSeconds != null
                            ? Math.max(
                                0,
                                win.resetAfterSeconds - Math.floor((now - usage.updatedAt) / 1000)
                              )
                            : null;
                        const resetStr =
                          resetSeconds != null
                            ? formatDuration(resetSeconds, durationLocale)
                            : null;
                        const winLabel =
                          win.id === "5h" || win.label === "5h"
                            ? t("usage.window5h")
                            : win.id === "7d" || win.label === "7d"
                            ? t("usage.window7d")
                            : win.id === "daily_free" || win.label === "Daily Free Requests"
                            ? t("usage.windowDailyFree")
                            : win.label;

                        return (
                          <div key={idx} className="space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-text-muted">{winLabel}</span>
                              <span className="font-mono font-medium">
                                {pct}%
                                {resetStr && (
                                  <span className="text-text-dim font-normal ml-1.5 text-[10px]">
                                    ({t("usage.resetIn", { time: resetStr })})
                                  </span>
                                )}
                              </span>
                            </div>
                            <div className="w-full h-1.5 bg-bg-elevated rounded-full overflow-hidden border border-border-subtle">
                              <div
                                className="h-full rounded-full transition-all duration-300"
                                style={{
                                  width: `${Math.min(100, Math.max(0, pct))}%`,
                                  backgroundColor:
                                    pct > 90
                                      ? "var(--danger)"
                                      : pct > 70
                                      ? "var(--warning)"
                                      : "var(--accent)",
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Balance Display */}
                  {usage.balance && usage.balance.length > 0 && (
                    <div className="pt-1.5 border-t border-divider flex flex-wrap gap-2 text-[11px]">
                      {usage.balance.map((b, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className="text-text-muted">{b.currency}:</span>
                          <span className="font-mono font-medium text-text">{b.total}</span>
                          {b.granted && Number(b.granted) > 0 && (
                            <span className="text-[10px] text-text-dim">
                              ({t("usage.gift")}: {b.granted})
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Raw Limit / Credits */}
                  {usage.rawLimit && (usage.rawLimit.used != null || usage.rawLimit.remaining != null) && (
                    <div className="pt-1.5 border-t border-divider flex justify-between text-[11px]">
                      {usage.rawLimit.used != null && (
                        <div>
                          <span className="text-text-muted">
                            {typeof usage.rawLimit.limit === "number" && usage.rawLimit.limit > 0
                              ? t("usage.used", {
                                  percent: Math.round((usage.rawLimit.used / usage.rawLimit.limit) * 100),
                                })
                              : `${t("usage.cost")}: $${usage.rawLimit.used}`}
                          </span>
                        </div>
                      )}
                      {usage.rawLimit.remaining != null && (
                        <div className="font-mono text-text">
                          <span className="text-text-muted">{t("usage.remaining")}: </span>
                          {typeof usage.rawLimit.remaining === "number"
                            ? `$${usage.rawLimit.remaining}`
                            : usage.rawLimit.remaining}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
