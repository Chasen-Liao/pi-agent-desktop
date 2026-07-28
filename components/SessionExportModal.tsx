"use client";

import React, { useState } from "react";

export interface SessionExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
}

export function SessionExportModal({ isOpen, onClose, sessionId }: SessionExportModalProps) {
  const [format, setFormat] = useState<"html" | "markdown">("html");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !sessionId) return null;

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const exportUrl = `/api/sessions/${encodeURIComponent(sessionId)}/export?format=${format}&download=true`;

      // Create hidden link and click to trigger browser download payload
      const a = document.createElement("a");
      a.href = exportUrl;
      a.download = `session-${sessionId}.${format === "html" ? "html" : "md"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export Session"
      className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md bg-bg border border-border rounded-panel shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-divider bg-bg-elevated">
          <h3 className="font-semibold text-text text-[14px]">Export Session</h3>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-text-muted hover:text-text text-[18px] leading-none px-2 py-1 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 flex flex-col gap-4">
          <p className="text-[12px] text-text-muted">
            Export session <code className="font-mono text-[11px] text-accent">{sessionId}</code> into standalone HTML or plain Markdown.
          </p>

          {error && (
            <div className="p-2.5 rounded-control bg-red-500/10 border border-red-500/20 text-red-400 text-[12px]">
              {error}
            </div>
          )}

          {/* Format selection cards */}
          <div className="flex flex-col gap-2.5">
            <label
              onClick={() => setFormat("html")}
              className={`flex items-start gap-3 p-3 rounded-panel border cursor-pointer transition-all ${
                format === "html"
                  ? "bg-accent/10 border-accent text-text"
                  : "bg-bg-panel border-border text-text-muted hover:border-border-subtle"
              }`}
            >
              <input
                type="radio"
                name="export-format"
                value="html"
                checked={format === "html"}
                onChange={() => setFormat("html")}
                className="mt-0.5 accent-accent"
              />
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-[13px] text-text">
                  Standalone HTML (.html)
                </span>
                <span className="text-[11px] text-text-muted leading-relaxed">
                  Interactive HTML document with syntax highlighting, styled assistant thoughts, and collapsible tool calls.
                </span>
              </div>
            </label>

            <label
              onClick={() => setFormat("markdown")}
              className={`flex items-start gap-3 p-3 rounded-panel border cursor-pointer transition-all ${
                format === "markdown"
                  ? "bg-accent/10 border-accent text-text"
                  : "bg-bg-panel border-border text-text-muted hover:border-border-subtle"
              }`}
            >
              <input
                type="radio"
                name="export-format"
                value="markdown"
                checked={format === "markdown"}
                onChange={() => setFormat("markdown")}
                className="mt-0.5 accent-accent"
              />
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-[13px] text-text">
                  Plain Markdown (.md)
                </span>
                <span className="text-[11px] text-text-muted leading-relaxed">
                  Clean text format containing user messages, assistant responses, and code blocks. Ideal for copy-pasting or LLM context.
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-divider bg-bg-elevated">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-control border border-border text-text-muted hover:text-text hover:bg-bg-hover transition-colors text-[12px] cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="px-4 py-1.5 rounded-control bg-accent text-accent-contrast font-medium hover:opacity-90 transition-opacity cursor-pointer text-[12px] disabled:opacity-50 flex items-center gap-1.5"
          >
            {downloading ? "Preparing Export..." : `Download ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
