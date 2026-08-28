"use client";

import { useEffect } from "react";

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
  useEffect(() => {
    console.error("[error-boundary]", error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-bg p-8 text-text">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-panel border border-danger-border bg-bg-elevated p-6 shadow-popover">
        <h2 className="text-base font-semibold text-text-strong">Something went wrong</h2>
        <p className="text-sm leading-relaxed text-text-muted">
          The interface hit an unexpected error while rendering. Session data stays safe on disk.
          Reload the interface to continue; if this keeps happening, restart the app.
        </p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-control border border-danger-border bg-danger-bg p-3 text-xs text-danger">
          {error.message}
        </pre>
        {error.digest ? <p className="text-xs text-text-dim">Error digest: {error.digest}</p> : null}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => retry()}
            className="cursor-pointer rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
          >
            Reload interface
          </button>
        </div>
      </div>
    </div>
  );
}
