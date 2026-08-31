"use client";

import React, { useState, useEffect } from "react";
import { useI18n } from "./I18nProvider";

export type BranchCloneMode = "branch" | "clone";

export interface BranchCloneModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: BranchCloneMode;
  sessionId: string | null;
  targetEntryId?: string;
  cwd?: string;
  onSuccess?: (newSessionId: string, newSessionFile: string) => void;
}

export function BranchCloneModal({
  isOpen,
  onClose,
  mode,
  sessionId,
  targetEntryId,
  cwd,
  onSuccess,
}: BranchCloneModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [targetCwd, setTargetCwd] = useState(cwd || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setTargetCwd(cwd || "");
      setError(null);
    }
  }, [isOpen, cwd, sessionId, targetEntryId]);
  if (!isOpen || !sessionId) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "branch" && !targetEntryId) {
      setError(t("branch.required"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const endpoint =
        mode === "branch"
          ? `/api/sessions/${encodeURIComponent(sessionId)}/branch`
          : `/api/sessions/${encodeURIComponent(sessionId)}/clone`;

      const payload =
        mode === "branch"
          ? { targetEntryId, name: name.trim() || undefined }
          : { targetCwd: targetCwd.trim() || undefined, name: name.trim() || undefined };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      if (onSuccess) {
        onSuccess(data.sessionId, data.sessionFile);
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("branch.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === "branch" ? t("branch.createTitle") : t("branch.cloneTitle");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="ui-dialog-backdrop fixed inset-0 z-[1000] flex items-center justify-center p-4"
    >
      <div className="t-modal is-open ui-dialog-surface w-full max-w-md rounded-[14px] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-divider bg-bg-elevated">
          <h3 className="font-semibold text-text text-[14px]">{title}</h3>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="text-text-muted hover:text-text text-[18px] leading-none px-2 py-1 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3.5">
          {error && (
            <div className="p-2.5 rounded-control bg-red-500/10 border border-red-500/20 text-red-400 text-[12px]">
              {error}
            </div>
          )}

          <p className="text-[12px] text-text-muted">
            {mode === "branch" ? t("branch.description") : t("branch.cloneDescription")}
          </p>

          {mode === "branch" && targetEntryId && (
            <div>
              <label className="block text-[11px] font-medium text-text-muted mb-1">
                {t("branch.point")}
              </label>
              <input
                type="text"
                value={targetEntryId}
                readOnly
                className="w-full px-2.5 py-1.5 rounded-control bg-bg-panel border border-border text-text-muted font-mono text-[11px] cursor-not-allowed opacity-80"
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] font-medium text-text-muted mb-1">
              {mode === "branch" ? t("branch.name") : t("branch.cloneName")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "branch" ? "e.g. Feature Exploration" : "e.g. Refactor Fork"}
              className="w-full px-2.5 py-1.5 rounded-control bg-bg border border-border text-text text-[12px] focus:outline-none focus:border-accent"
              autoFocus
            />
          </div>

          {mode === "clone" && (
            <div>
              <label className="block text-[11px] font-medium text-text-muted mb-1">
                {t("branch.targetDirectory")}
              </label>
              <input
                type="text"
                value={targetCwd}
                onChange={(e) => setTargetCwd(e.target.value)}
                placeholder={t("branch.currentDirectoryPlaceholder")}
                className="w-full px-2.5 py-1.5 rounded-control bg-bg border border-border text-text font-mono text-[12px] focus:outline-none focus:border-accent"
              />
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-divider mt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-control border border-border text-text-muted hover:text-text hover:bg-bg-hover transition-colors text-[12px] cursor-pointer"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-1.5 rounded-control bg-accent text-accent-contrast font-medium hover:opacity-90 transition-opacity cursor-pointer text-[12px] disabled:opacity-50"
            >
              {submitting
                ? t("branch.processing")
                : mode === "branch"
                ? t("branch.createAction")
                : t("branch.cloneAction")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
