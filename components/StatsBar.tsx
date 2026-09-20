"use client";

import React, { useState, useRef, useCallback } from "react";
import { useI18n } from "./I18nProvider";
import { useUpstreamUsage } from "@/hooks/useUpstreamUsage";
import { UsagePopover } from "./UsagePopover";

import type { SessionStats } from "@/hooks/agent-session/session-stats";
import type { ContextUsage } from "@/lib/pi-types";

export type { SessionStats, ContextUsage };

export interface StatsBarProps {
  showChat: boolean;
  sessionStats?: SessionStats | null;
  contextUsage?: ContextUsage | null;
  currentProvider?: string | null;
}

export const StatsBar = React.memo(function StatsBar({
  showChat,
  sessionStats = null,
  contextUsage = null,
  currentProvider = null,
}: StatsBarProps) {
  const { t } = useI18n();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const {
    usages,
    currentUsage,
    loading: upstreamLoading,
    refresh: refreshUpstream,
  } = useUpstreamUsage(currentProvider);

  const togglePopover = useCallback(() => {
    if (containerRef.current) {
      setAnchorRect(containerRef.current.getBoundingClientRect());
    }
    setPopoverOpen((prev) => !prev);
  }, []);

  const closePopover = useCallback(() => {
    setPopoverOpen(false);
  }, []);

  if (!showChat || (!sessionStats && !contextUsage && !currentUsage && usages.length === 0)) {
    return null;
  }

  const tks = sessionStats?.tokens;
  const c = sessionStats?.cost ?? 0;
  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
      ? `${(n / 1000).toFixed(0)}k`
      : String(n);
  const costStr = c > 0 ? (c >= 0.01 ? `$${c.toFixed(2)}` : `<$0.01`) : null;

  // Calculate cache hit rate if available or derivable
  const cacheHitRate =
    sessionStats?.cacheHitRate != null && Number.isFinite(sessionStats.cacheHitRate)
      ? sessionStats.cacheHitRate
      : tks && (tks.input + tks.cacheRead + tks.cacheWrite > 0) && tks.cacheRead > 0
      ? (tks.cacheRead / (tks.input + tks.cacheRead + tks.cacheWrite)) * 100
      : null;

  let ctxColor = "var(--text-muted)";
  let ctxStr: string | null = null;
  if (contextUsage?.contextWindow) {
    const pct = contextUsage.percent;
    if (pct !== null && pct > 90) ctxColor = "var(--danger)";
    else if (pct !== null && pct > 70) ctxColor = "var(--warning)";
    const pctStr = pct !== null ? `${pct.toFixed(1)}%` : "?";
    ctxStr = `${pctStr}/${fmt(contextUsage.contextWindow)} ${t("usage.auto")}`;
  }

  const tooltipParts: string[] = [];
  if (tks) {
    tooltipParts.push(t("usage.tooltip.in", { count: tks.input.toLocaleString() }));
    tooltipParts.push(t("usage.tooltip.out", { count: tks.output.toLocaleString() }));
    tooltipParts.push(t("usage.tooltip.cacheRead", { count: tks.cacheRead.toLocaleString() }));
    tooltipParts.push(t("usage.tooltip.cacheWrite", { count: tks.cacheWrite.toLocaleString() }));
    if (cacheHitRate !== null) {
      tooltipParts.push(t("usage.tooltip.cacheHit", { rate: cacheHitRate.toFixed(1) }));
    }
    if (c > 0) {
      tooltipParts.push(t("usage.tooltip.cost", { cost: c.toFixed(4) }));
    }
  }
  if (contextUsage?.contextWindow) {
    const pct = contextUsage.percent;
    tooltipParts.push(
      t("usage.tooltip.context", {
        percent: pct !== null ? `${pct.toFixed(1)}%` : "?",
        total: contextUsage.contextWindow.toLocaleString(),
      })
    );
  }
  if (currentUsage) {
    tooltipParts.push(t("usage.tooltip.quota", { name: currentUsage.providerName }));
  }
  tooltipParts.push(t("usage.title"));
  const tooltip = tooltipParts.join("  |  ");

  const isSubOrOAuth = Boolean(
    currentUsage &&
      (currentUsage.provider === "openai-codex" ||
        currentUsage.provider === "anthropic" ||
        (currentUsage.planType && /sub|plus|pro|team|enterprise/i.test(currentUsage.planType)))
  );

  return (
    <div ref={containerRef} className="relative h-full flex items-stretch [-webkit-app-region:no-drag]">
      <button
        type="button"
        onClick={togglePopover}
        title={tooltip}
        aria-label={t("usage.title")}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        className={`flex items-center gap-2 h-full px-2.5 text-[11px] font-mono tabular-nums select-none cursor-pointer border-none border-l border-divider transition-colors duration-150 ${
          popoverOpen
            ? "bg-bg-selected text-text border-t-2 border-t-accent"
            : "bg-transparent text-text-muted hover:text-text hover:bg-bg-hover/60 border-t-2 border-t-transparent"
        }`}
      >
        {tks && tks.input > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="text-accent font-semibold">↑</span>
            <span>{fmt(tks.input)}</span>
          </span>
        )}
        {tks && tks.output > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="text-info font-semibold">↓</span>
            <span>{fmt(tks.output)}</span>
          </span>
        )}
        {tks && tks.cacheRead > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="text-success font-semibold">R</span>
            <span>{fmt(tks.cacheRead)}</span>
          </span>
        )}
        {tks && tks.cacheWrite > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="text-warning font-semibold">W</span>
            <span>{fmt(tks.cacheWrite)}</span>
          </span>
        )}
        {cacheHitRate !== null && cacheHitRate > 0 && (
          <span className="flex items-center gap-0.5">
            <span className="text-text-dim">CH</span>
            <span className="font-medium text-text">{cacheHitRate.toFixed(1)}%</span>
          </span>
        )}
        {costStr && (
          <span className="font-medium text-text">
            {costStr}
          </span>
        )}
        {ctxStr && (
          <span className="flex items-center gap-1" style={{ color: ctxColor }}>
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 9 L1 5 Q1 1 5 1 Q9 1 9 5 L9 9" />
              <line x1="1" y1="9" x2="9" y2="9" />
            </svg>
            <span>{ctxStr}</span>
          </span>
        )}

        {/* Upstream Quota Mini Pill */}
        {currentUsage && currentUsage.windows && currentUsage.windows.length > 0 && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-control bg-bg-elevated border border-border text-[10px] text-text-muted font-normal">
            <span className="text-text font-medium">{currentUsage.providerName}</span>
            {isSubOrOAuth && (
              <span className="text-accent font-medium text-[9px]">{t("usage.sub")}</span>
            )}
            {currentUsage.windows.slice(0, 2).map((win, idx) => {
              const label =
                win.id === "5h" || win.label === "5h"
                  ? "5h"
                  : win.id === "7d" || win.label === "7d"
                  ? "7d"
                  : win.id === "daily_free" || win.label === "Daily Free Requests"
                  ? t("usage.dailyFree")
                  : (win.id ?? win.label);
              const colorClass =
                win.usedPercent > 90
                  ? "text-danger font-medium"
                  : win.usedPercent > 70
                  ? "text-warning font-medium"
                  : "text-text";
              return (
                <span key={idx} className="flex items-center gap-0.5">
                  <span className="text-text-dim">{label}:</span>
                  <span className={colorClass}>{win.usedPercent}%</span>
                  {idx < Math.min(2, currentUsage.windows!.length) - 1 && (
                    <span className="text-text-dim">|</span>
                  )}
                </span>
              );
            })}
          </span>
        )}

        {currentUsage && (!currentUsage.windows || currentUsage.windows.length === 0) && currentUsage.balance && currentUsage.balance.length > 0 && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-control bg-bg-elevated border border-border text-[10px] text-text-muted font-normal">
            <span className="text-text font-medium">{currentUsage.providerName}</span>
            {isSubOrOAuth && (
              <span className="text-accent font-medium text-[9px]">{t("usage.sub")}</span>
            )}
            <span className="text-text">{currentUsage.balance[0].currency}{currentUsage.balance[0].total}</span>
          </span>
        )}

        {currentUsage &&
          (!currentUsage.windows || currentUsage.windows.length === 0) &&
          (!currentUsage.balance || currentUsage.balance.length === 0) &&
          currentUsage.rawLimit?.remaining != null &&
          Number.isFinite(Number(currentUsage.rawLimit.remaining)) && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-control bg-bg-elevated border border-border text-[10px] text-text-muted font-normal">
              <span className="text-text font-medium">{currentUsage.providerName}</span>
              {isSubOrOAuth && (
                <span className="text-accent font-medium text-[9px]">{t("usage.sub")}</span>
              )}
              <span className="text-text">${currentUsage.rawLimit.remaining}</span>
            </span>
        )}

        {currentUsage &&
          (!currentUsage.windows || currentUsage.windows.length === 0) &&
          (!currentUsage.balance || currentUsage.balance.length === 0) &&
          currentUsage.rawLimit?.remaining == null &&
          !currentUsage.error &&
          isSubOrOAuth && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-control bg-bg-elevated border border-border text-[10px] text-text-muted font-normal">
              <span className="text-text font-medium">{currentUsage.providerName}</span>
              <span className="text-accent font-medium text-[9px]">{t("usage.sub")}</span>
            </span>
        )}

        {/* Subtle Chevron indicator */}
        <svg
          width="8"
          height="8"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-150 text-text-dim ${
            popoverOpen ? "rotate-180 text-text" : ""
          }`}
        >
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      <UsagePopover
        open={popoverOpen}
        onClose={closePopover}
        anchorRect={anchorRect}
        sessionStats={sessionStats}
        contextUsage={contextUsage}
        upstreamUsage={currentUsage}
        allUsages={usages}
        loading={upstreamLoading}
        onRefresh={refreshUpstream}
      />
    </div>
  );
});
