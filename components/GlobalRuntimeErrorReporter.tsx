"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";

const LOG_PREFIX = "[global-runtime-error]";
// Throttle: at most one toast per window; console logging stays unlimited.
const TOAST_THROTTLE_MS = 3000;
const TOAST_VISIBLE_MS = 5000;
const REASON_MAX_CHARS = 160;

interface RuntimeNotice {
  id: number;
  reason: string;
}

function formatReason(value: unknown): string {
  if (value instanceof Error) {
    return value.message || value.name;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular or otherwise unserializable rejection reasons.
    return String(value);
  }
}

function truncateReason(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > REASON_MAX_CHARS
    ? `${trimmed.slice(0, REASON_MAX_CHARS)}…`
    : trimmed;
}

// Window-level error net: exceptions in async callbacks (unhandledrejection)
// and outside React's render phase (window "error") never reach the error
// boundaries in app/error.tsx / app/global-error.tsx and previously vanished
// silently. Every event is logged with a fixed prefix; the user also gets a
// lightweight, dependency-free toast (no toast library in this project).
export default function GlobalRuntimeErrorReporter() {
  const { t } = useI18n();
  const [notice, setNotice] = useState<RuntimeNotice | null>(null);
  const lastToastAtRef = useRef(0);
  const nextIdRef = useRef(0);
  const hideTimerRef = useRef<number | null>(null);

  const showNotice = useCallback((reason: string) => {
    const now = Date.now();
    if (now - lastToastAtRef.current < TOAST_THROTTLE_MS) {
      return;
    }
    lastToastAtRef.current = now;
    nextIdRef.current += 1;
    setNotice({ id: nextIdRef.current, reason: truncateReason(reason) });
  }, []);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const location =
        event.filename || event.lineno
          ? ` (${event.filename}:${event.lineno}:${event.colno})`
          : "";
      console.error(LOG_PREFIX, "uncaught error:", event.error ?? event.message, location);
      showNotice(formatReason(event.error ?? event.message));
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error(LOG_PREFIX, "unhandled promise rejection:", event.reason);
      showNotice(formatReason(event.reason));
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    // Cleanup removes both listeners so React strict mode double-invocation
    // never leaves duplicate registrations behind.
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [showNotice]);

  // Auto-dismiss the current toast; re-arming per notice id means a newer
  // toast replaces an older one and gets its own full visibility window.
  useEffect(() => {
    if (!notice) {
      return;
    }
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setNotice(null);
    }, TOAST_VISIBLE_MS);
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [notice]);

  if (!notice) {
    return null;
  }

  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 z-50 flex w-max max-w-[min(90vw,36rem)] -translate-x-1/2 items-center gap-2 rounded-panel border border-danger-border bg-bg-elevated px-3 py-2 shadow-popover backdrop-blur"
    >
      <span className="shrink-0 text-xs font-medium text-text-strong">
        {t("runtimeError.toast")}
      </span>
      {notice.reason ? (
        <code className="min-w-0 flex-1 truncate text-xs text-text-muted" title={notice.reason}>
          {notice.reason}
        </code>
      ) : null}
      <button
        type="button"
        onClick={() => setNotice(null)}
        aria-label={t("runtimeError.dismiss")}
        className="shrink-0 cursor-pointer rounded-control px-1 text-sm leading-none text-text-muted transition-colors hover:text-text-strong"
      >
        ×
      </button>
    </div>
  );
}
