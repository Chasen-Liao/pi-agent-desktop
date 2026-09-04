"use client";

import React, { useState, useEffect } from "react";
import type { TranslationKey } from "@/lib/i18n";
import { useI18n } from "./I18nProvider";

export type BranchCloneMode = "branch" | "clone";
type CloneWorkspaceMode = "directory" | "worktree";

const CLONE_ERROR_TRANSLATIONS: Partial<Record<string, TranslationKey>> = {
  INVALID_CLONE_PAYLOAD: "branch.invalidClonePayload",
  INVALID_TARGET_CWD: "branch.invalidTargetDirectory",
  INVALID_CLONE_NAME: "branch.invalidCloneName",
  INVALID_WORKSPACE_MODE: "branch.invalidWorkspaceMode",
  INVALID_BRANCH_NAME: "branch.invalidBranchName",
  BRANCH_NAME_REQUIRES_WORKTREE: "branch.branchNameRequiresWorktree",
  GIT_UNAVAILABLE: "branch.gitUnavailable",
  NOT_GIT_REPOSITORY: "branch.notGitRepository",
  INVALID_BRANCH: "branch.invalidBranch",
  TARGET_INSIDE_REPOSITORY: "branch.targetInsideRepository",
  TARGET_EXISTS: "branch.targetExists",
  WORKTREE_CREATE_FAILED: "branch.worktreeCreateFailed",
  SESSION_NOT_FOUND: "branch.sessionNotFound",
  INVALID_BRANCH_PAYLOAD: "branch.invalidBranchPayload",
  INVALID_TARGET_ENTRY_ID: "branch.invalidTargetEntryId",
  TARGET_ENTRY_NOT_FOUND: "branch.targetEntryNotFound",
  BRANCH_CREATE_FAILED: "branch.createFailed",
  INVALID_JSON_PAYLOAD: "branch.invalidJsonPayload",
  CLONE_CREATE_FAILED: "branch.cloneFailed",
  CLONE_OPERATION_FAILED: "branch.failed",
  BRANCH_OPERATION_FAILED: "branch.failed",
};

function getCloneErrorMessage(
  errorCode: unknown,
  t: (key: TranslationKey) => string,
): string {
  if (typeof errorCode === "string") {
    const key = CLONE_ERROR_TRANSLATIONS[errorCode];
    if (key) return t(key);
  }
  return t("branch.failed");
}

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
  const [workspaceMode, setWorkspaceMode] = useState<CloneWorkspaceMode>("directory");
  const [branchName, setBranchName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setTargetCwd(cwd || "");
      setWorkspaceMode("directory");
      setBranchName("");
      setError(null);
    }
  }, [isOpen, cwd, sessionId, targetEntryId]);
  if (!isOpen || !sessionId) return null;

  const selectWorkspaceMode = (nextMode: CloneWorkspaceMode) => {
    setWorkspaceMode(nextMode);
    setTargetCwd(nextMode === "directory" ? cwd || "" : "");
    if (nextMode === "directory") {
      setBranchName("");
    }
  };

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
          : {
              targetCwd: targetCwd.trim() || undefined,
              name: name.trim() || undefined,
              workspaceMode,
              branchName:
                workspaceMode === "worktree" ? branchName.trim() || undefined : undefined,
            };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as {
        success?: boolean;
        sessionId?: unknown;
        sessionFile?: unknown;
        errorCode?: unknown;
      };
      if (!res.ok || !data.success) {
        setError(getCloneErrorMessage(data.errorCode, t));
        return;
      }
      if (typeof data.sessionId !== "string" || typeof data.sessionFile !== "string") {
        setError(t("branch.failed"));
        return;
      }

      if (onSuccess) {
        onSuccess(data.sessionId, data.sessionFile);
      }
      onClose();
    } catch {
      setError(t("branch.failed"));
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
            <>
              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1.5">
                  {t("branch.workspaceMode")}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={submitting}
                    aria-pressed={workspaceMode === "directory"}
                    onClick={() => selectWorkspaceMode("directory")}
                    className={`px-3 py-2 rounded-control border text-[12px] text-left transition-colors cursor-pointer disabled:opacity-50 ${
                      workspaceMode === "directory"
                        ? "border-accent bg-accent/10 text-text"
                        : "border-border bg-bg text-text-muted hover:text-text hover:bg-bg-hover"
                    }`}
                  >
                    {t("branch.workspaceDirectory")}
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    aria-pressed={workspaceMode === "worktree"}
                    onClick={() => selectWorkspaceMode("worktree")}
                    className={`px-3 py-2 rounded-control border text-[12px] text-left transition-colors cursor-pointer disabled:opacity-50 ${
                      workspaceMode === "worktree"
                        ? "border-accent bg-accent/10 text-text"
                        : "border-border bg-bg text-text-muted hover:text-text hover:bg-bg-hover"
                    }`}
                  >
                    {t("branch.workspaceWorktree")}
                  </button>
                </div>
                {workspaceMode === "worktree" && (
                  <p className="mt-1.5 text-[11px] text-text-muted">
                    {t("branch.worktreeHint")}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  {t("branch.targetDirectory")}
                </label>
                <input
                  type="text"
                  value={targetCwd}
                  onChange={(e) => setTargetCwd(e.target.value)}
                  placeholder={
                    workspaceMode === "worktree"
                      ? t("branch.worktreeDirectoryPlaceholder")
                      : t("branch.currentDirectoryPlaceholder")
                  }
                  className="w-full px-2.5 py-1.5 rounded-control bg-bg border border-border text-text font-mono text-[12px] focus:outline-none focus:border-accent"
                />
              </div>

              {workspaceMode === "worktree" && (
                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    {t("branch.name")}
                  </label>
                  <input
                    type="text"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-control bg-bg border border-border text-text font-mono text-[12px] focus:outline-none focus:border-accent"
                  />
                </div>
              )}
            </>
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
