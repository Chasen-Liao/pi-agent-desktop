"use client";

import { useEffect } from "react";
import { useI18n } from "@/components/I18nProvider";

// Global React error boundary (Next.js error.tsx convention). Without this,
// any uncaught render-phase exception unmounts the whole component tree and
// leaves a permanently blank window (issue #20).
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    console.error("[error-boundary]", error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-bg p-8 text-text">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-panel border border-danger-border bg-bg-elevated p-6 shadow-popover">
        <h2 className="text-base font-semibold text-text-strong">{t("error.title")}</h2>
        <p className="text-sm leading-relaxed text-text-muted">
          {t("error.description")}
        </p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-control border border-danger-border bg-danger-bg p-3 text-xs text-danger">
          {error.message}
        </pre>
        {error.digest ? <p className="text-xs text-text-dim">{t("error.digest", { digest: error.digest })}</p> : null}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => retry()}
            className="cursor-pointer rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
          >
            {t("error.reload")}
          </button>
        </div>
      </div>
    </div>
  );
}
