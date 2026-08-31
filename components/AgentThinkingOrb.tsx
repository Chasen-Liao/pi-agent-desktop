"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AgentPhase } from "@/hooks/agent-session/agent-phase";
import { LiquidOrbCanvas } from "./LiquidOrbCanvas";
import { useI18n } from "./I18nProvider";
import type { TranslationKey, TranslationValues } from "@/lib/i18n";

interface Props {
  phase: AgentPhase;
  thinking?: string;
}

function getPhaseLabel(
  phase: AgentPhase,
  t: (key: TranslationKey, values?: TranslationValues) => string,
): string {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((tool) => tool.name);
    if (names.length === 0) return t("agent.runningTools");
    if (names.length <= 3) return t("agent.runningTool", { tools: names.join(", ") });
    return t("agent.runningManyTools", { tools: names.slice(0, 2).join(", "), count: names.length - 2 });
  }
  if (phase?.kind === "waiting_model") return t("agent.waitingModel");
  return t("agent.thinking");
}

export function AgentThinkingOrb({ phase, thinking = "" }: Props) {
  const { t } = useI18n();
  const label = getPhaseLabel(phase, t);
  const [activeLabel, setActiveLabel] = useState(label);
  const activeLabelRef = useRef(label);
  const [previousLabel, setPreviousLabel] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const thinkingPanelId = useId();
  const thinkingContentRef = useRef<HTMLDivElement>(null);
  const hasThinking = thinking.trim().length > 0;

  useEffect(() => {
    const previous = activeLabelRef.current;
    if (label === previous) return;

    activeLabelRef.current = label;
    setPreviousLabel(previous);
    setActiveLabel(label);
    setEntering(true);

    let enterFrame = 0;
    const releaseFrame = requestAnimationFrame(() => {
      enterFrame = requestAnimationFrame(() => setEntering(false));
    });
    const cleanup = window.setTimeout(() => setPreviousLabel(null), 200);

    return () => {
      cancelAnimationFrame(releaseFrame);
      cancelAnimationFrame(enterFrame);
      window.clearTimeout(cleanup);
    };
  }, [label]);

  useEffect(() => {
    if (!expanded || !hasThinking) return;
    const frame = requestAnimationFrame(() => {
      const content = thinkingContentRef.current;
      if (content) content.scrollTop = content.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded, hasThinking, thinking]);

  const sizerLabel = previousLabel && previousLabel.length > activeLabel.length ? previousLabel : activeLabel;

  return (
    <div
      className="t-acc max-w-[680px]"
      data-open={expanded && hasThinking ? "true" : "false"}
    >
      <button
        type="button"
        className={`t-acc-head flex w-full items-center gap-2.5 border-none bg-transparent py-2 text-left${hasThinking ? " cursor-pointer" : " cursor-default"}`}
        onClick={() => hasThinking && setExpanded((open) => !open)}
        disabled={!hasThinking}
        aria-expanded={expanded && hasThinking}
        aria-controls={hasThinking ? thinkingPanelId : undefined}
        aria-label={hasThinking ? (expanded ? t("message.collapseThinking") : t("message.expandThinking")) : activeLabel}
      >
        <LiquidOrbCanvas />
        <span className="t-think text-[12px]" role="status" aria-live="polite">
          <span className="t-think-sizer" aria-hidden="true">{sizerLabel}</span>
          {previousLabel && (
            <span className="t-think-text is-exit" data-text={previousLabel} aria-hidden="true">
              {previousLabel}
            </span>
          )}
          <span className={`t-think-text${entering ? " is-enter-start" : ""}`} data-text={activeLabel}>
            {activeLabel}
          </span>
        </span>
        {hasThinking && (
          <span className="t-acc-chevron ml-0.5 text-text-dim" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6.5L8 10.5L12 6.5" />
            </svg>
          </span>
        )}
      </button>
      <div
        id={thinkingPanelId}
        className="t-acc-panel"
        aria-hidden={!expanded || !hasThinking}
      >
        <div className="t-acc-panel-inner pl-14 pr-2 pb-2">
          <div
            ref={thinkingContentRef}
            className="max-h-56 overflow-y-auto rounded-panel border border-border bg-bg-panel px-3 py-2.5 text-[12px] leading-[1.65] whitespace-pre-wrap text-text-muted"
          >
            {thinking}
          </div>
        </div>
      </div>
    </div>
  );
}
