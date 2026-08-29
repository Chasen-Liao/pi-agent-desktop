"use client";

import React, { useState, useEffect, useCallback } from "react";
import { McpConfigContent } from "./McpConfigModal";
import { getExtensionRenderKey } from "@/lib/extension-render-key";
import type { ExtensionInfo, SkillInfo, ExtensionDiagnostic } from "@/lib/extensions-config";
import { useI18n } from "./I18nProvider";

export type ExtensionsTab = "mcp" | "extensions" | "skills" | "diagnostics";

export interface ExtensionsConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  cwd?: string;
  initialTab?: ExtensionsTab;
}

export function ExtensionsConfigModal({
  isOpen,
  onClose,
  cwd,
  initialTab = "mcp",
}: ExtensionsConfigModalProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<ExtensionsTab>(initialTab);
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [diagnostics, setDiagnostics] = useState<ExtensionDiagnostic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add Item State
  const [addType, setAddType] = useState<"extension" | "skill">("extension");
  const [addNameOrPath, setAddNameOrPath] = useState("");
  const [addScope, setAddScope] = useState<"global" | "project">("project");
  const [adding, setAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const fetchExtensionsData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = cwd ? `/api/extensions?cwd=${encodeURIComponent(cwd)}` : "/api/extensions";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setExtensions(data.extensions || []);
      setSkills(data.skills || []);
      setDiagnostics(data.diagnostics || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("extension.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [cwd, t]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      fetchExtensionsData();
    }
  }, [isOpen, initialTab, fetchExtensionsData]);

  if (!isOpen) return null;

  const handleToggleExtension = async (ext: ExtensionInfo) => {
    try {
      const res = await fetch("/api/extensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle",
          type: "extension",
          nameOrPath: ext.id,
          scope: ext.scope === "global" ? "global" : "project",
          cwd,
          enabled: !ext.enabled,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchExtensionsData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("extension.toggleFailed"));
    }
  };

  const handleRemoveExtension = async (ext: ExtensionInfo) => {
    if (!confirm(t("extension.removeConfirm", { name: ext.name || ext.id }))) return;
    try {
      const res = await fetch("/api/extensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove",
          type: "extension",
          nameOrPath: ext.id,
          scope: ext.scope === "global" ? "global" : "project",
          cwd,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchExtensionsData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("extension.removeFailed"));
    }
  };

  const handleToggleSkill = async (skill: SkillInfo) => {
    try {
      const res = await fetch("/api/extensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle",
          type: "skill",
          nameOrPath: skill.name,
          scope: skill.scope === "global" ? "global" : "project",
          cwd,
          enabled: skill.disableModelInvocation ? true : false,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchExtensionsData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("extension.skillToggleFailed"));
    }
  };

  const handleRemoveSkill = async (skill: SkillInfo) => {
    if (!confirm(t("extension.skillRemoveConfirm", { name: skill.name }))) return;
    try {
      const res = await fetch("/api/extensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove",
          type: "skill",
          nameOrPath: skill.name,
          scope: skill.scope === "global" ? "global" : "project",
          cwd,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchExtensionsData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("extension.skillRemoveFailed"));
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addNameOrPath.trim()) return;

    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/extensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          type: addType,
          nameOrPath: addNameOrPath.trim(),
          scope: addScope,
          cwd,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setAddNameOrPath("");
      setShowAddForm(false);
      fetchExtensionsData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("extension.addFailed"));
    } finally {
      setAdding(false);
    }
  };

  const tabs: { id: ExtensionsTab; label: string; count?: number }[] = [
    { id: "mcp", label: t("mcp.servers") },
    { id: "extensions", label: t("extension.extensions"), count: extensions.length },
    { id: "skills", label: t("extension.skills"), count: skills.length },
    { id: "diagnostics", label: t("extension.diagnostics"), count: diagnostics.length },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("extension.title")}
      className="ui-dialog-backdrop fixed inset-0 z-[1000] flex items-center justify-center p-4"
    >
      <div className="t-modal is-open ui-dialog-surface w-full max-w-4xl h-[82vh] max-h-[750px] rounded-[14px] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-divider bg-bg-elevated shrink-0">
          <h3 className="font-semibold text-text text-[14px]">{t("extension.management")}</h3>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="text-text-muted hover:text-text text-[18px] leading-none px-2 py-1 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Tabs Bar */}
        <div className="flex items-center border-b border-divider bg-bg-elevated px-4 gap-1 shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-2 text-[12px] font-medium border-b-2 transition-[background-color,border-color,color] duration-150 cursor-pointer flex items-center gap-1.5 ${
                activeTab === t.id
                  ? "border-accent text-accent bg-bg"
                  : "border-transparent text-text-muted hover:text-text hover:bg-bg-hover"
              }`}
            >
              {t.label}
              {t.count !== undefined && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    activeTab === t.id ? "bg-accent/20 text-accent" : "bg-bg-elevated text-text-dim"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {error && (
            <div className="m-4 p-3 rounded-control bg-red-500/10 border border-red-500/20 text-red-400 text-[12px] flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-400 font-bold ml-2">
                ×
              </button>
            </div>
          )}

          {activeTab === "mcp" && <McpConfigContent cwd={cwd} />}

          {activeTab === "extensions" && (
            <div className="p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-text-muted">
                  {t("extension.manageHint")}
                </span>
                <button
                  onClick={() => {
                    setAddType("extension");
                    setShowAddForm(!showAddForm);
                  }}
                  className="px-3 py-1.5 rounded-control bg-accent text-accent-contrast font-medium text-[12px] hover:opacity-90 transition-opacity cursor-pointer"
                >
                  {t("extension.addAction")}
                </button>
              </div>

              {showAddForm && (
                <form
                  onSubmit={handleAddSubmit}
                  className="p-3 rounded-panel bg-bg-panel border border-border flex flex-col gap-3"
                >
                  <h4 className="text-[12px] font-semibold text-text">{t("extension.add")}</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={addNameOrPath}
                      onChange={(e) => setAddNameOrPath(e.target.value)}
                      placeholder={t("extension.addPlaceholder")}
                      className="col-span-2 px-2.5 py-1.5 rounded-control bg-bg border border-border text-text font-mono text-[12px] focus:outline-none focus:border-accent"
                      required
                    />
                    <select
                      value={addScope}
                      onChange={(e) => setAddScope(e.target.value as "global" | "project")}
                      className="px-2.5 py-1.5 rounded-control bg-bg border border-border text-text text-[12px] focus:outline-none focus:border-accent"
                    >
                      <option value="project">{t("scope.project")}</option>
                      <option value="global">{t("scope.global")}</option>
                    </select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddForm(false)}
                      className="px-3 py-1 text-[11px] rounded-control border border-border text-text-muted"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="submit"
                      disabled={adding}
                      className="px-3 py-1 text-[11px] rounded-control bg-accent text-accent-contrast font-medium"
                    >
                      {adding ? t("common.adding") : t("common.add")}
                    </button>
                  </div>
                </form>
              )}

              {loading ? (
                <div className="text-center py-10 text-text-muted text-[12px]">
                  {t("extension.loading")}
                </div>
              ) : extensions.length === 0 ? (
                <div className="text-center py-12 text-text-muted text-[12px] border border-dashed border-border rounded-panel">
                  {t("extension.none")}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {extensions.map((ext) => (
                    <div
                      key={getExtensionRenderKey(ext)}
                      className="flex items-center justify-between p-3 rounded-panel bg-bg-panel border border-border"
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-text text-[13px]">{ext.name}</span>
                          <span className="font-mono text-[11px] text-text-dim">({ext.id})</span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-mono uppercase ${
                              ext.scope === "global"
                                ? "bg-indigo-500/10 text-indigo-400"
                                : "bg-amber-500/10 text-amber-400"
                            }`}
                          >
                            {t(ext.scope === "global" ? "scope.global" : "scope.project")}
                          </span>
                        </div>
                        {ext.path && (
                          <span className="font-mono text-[10px] text-text-dim">{ext.path}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggleExtension(ext)}
                          className={`px-2.5 py-1 rounded-control text-[11px] font-medium border cursor-pointer ${
                            ext.enabled
                              ? "bg-green-500/10 text-green-400 border-green-500/20"
                              : "bg-bg-elevated text-text-muted border-border"
                          }`}
                        >
                          {ext.enabled ? t("common.enabled") : t("common.disabled")}
                        </button>
                        <button
                          onClick={() => handleRemoveExtension(ext)}
                          className="px-2.5 py-1 rounded-control border border-red-500/30 text-red-400 hover:bg-red-500/10 text-[11px] cursor-pointer"
                        >
                          {t("common.remove")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "skills" && (
            <div className="p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-text-muted">
                  {t("extension.skillsHint")}
                </span>
                <button
                  onClick={() => {
                    setAddType("skill");
                    setShowAddForm(!showAddForm);
                  }}
                  className="px-3 py-1.5 rounded-control bg-accent text-accent-contrast font-medium text-[12px] hover:opacity-90 transition-opacity cursor-pointer"
                >
                  {t("extension.addSkillAction")}
                </button>
              </div>

              {showAddForm && (
                <form
                  onSubmit={handleAddSubmit}
                  className="p-3 rounded-panel bg-bg-panel border border-border flex flex-col gap-3"
                >
                  <h4 className="text-[12px] font-semibold text-text">{t("extension.addSkill")}</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={addNameOrPath}
                      onChange={(e) => setAddNameOrPath(e.target.value)}
                      placeholder={t("extension.skillPlaceholder")}
                      className="col-span-2 px-2.5 py-1.5 rounded-control bg-bg border border-border text-text font-mono text-[12px] focus:outline-none focus:border-accent"
                      required
                    />
                    <select
                      value={addScope}
                      onChange={(e) => setAddScope(e.target.value as "global" | "project")}
                      className="px-2.5 py-1.5 rounded-control bg-bg border border-border text-text text-[12px] focus:outline-none focus:border-accent"
                    >
                      <option value="project">{t("scope.project")}</option>
                      <option value="global">{t("scope.global")}</option>
                    </select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddForm(false)}
                      className="px-3 py-1 text-[11px] rounded-control border border-border text-text-muted"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="submit"
                      disabled={adding}
                      className="px-3 py-1 text-[11px] rounded-control bg-accent text-accent-contrast font-medium"
                    >
                      {adding ? t("common.adding") : t("common.add")}
                    </button>
                  </div>
                </form>
              )}

              {loading ? (
                <div className="text-center py-10 text-text-muted text-[12px]">
                  {t("extension.skillsLoading")}
                </div>
              ) : skills.length === 0 ? (
                <div className="text-center py-12 text-text-muted text-[12px] border border-dashed border-border rounded-panel">
                  {t("extension.skillsNone")}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {skills.map((skill) => (
                    <div
                      key={`${skill.scope}-${skill.name}`}
                      className="flex items-center justify-between p-3 rounded-panel bg-bg-panel border border-border"
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-text text-[13px]">{skill.name}</span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-mono uppercase ${
                              skill.scope === "global"
                                ? "bg-indigo-500/10 text-indigo-400"
                                : "bg-amber-500/10 text-amber-400"
                            }`}
                          >
                            {t(skill.scope === "global" ? "scope.global" : "scope.project")}
                          </span>
                        </div>
                        {skill.description && (
                          <span className="text-[11px] text-text-muted">{skill.description}</span>
                        )}
                        {skill.filePath && (
                          <span className="font-mono text-[10px] text-text-dim">{skill.filePath}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggleSkill(skill)}
                          className={`px-2.5 py-1 rounded-control text-[11px] font-medium border cursor-pointer ${
                            !skill.disableModelInvocation
                              ? "bg-green-500/10 text-green-400 border-green-500/20"
                              : "bg-bg-elevated text-text-muted border-border"
                          }`}
                        >
                          {!skill.disableModelInvocation ? t("common.enabled") : t("common.disabled")}
                        </button>
                        <button
                          onClick={() => handleRemoveSkill(skill)}
                          className="px-2.5 py-1 rounded-control border border-red-500/30 text-red-400 hover:bg-red-500/10 text-[11px] cursor-pointer"
                        >
                          {t("common.remove")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "diagnostics" && (
            <div className="p-4 flex flex-col gap-3">
              <span className="text-[12px] text-text-muted">
                {t("extension.diagnosticsHint")}
              </span>

              {diagnostics.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 border border-dashed border-border rounded-panel text-green-400 text-[12px] gap-1">
                  <span>✓ {t("extension.diagnosticsClean")}</span>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {diagnostics.map((diag, index) => (
                    <div
                      key={index}
                      className={`p-3 rounded-panel border text-[12px] flex flex-col gap-1 ${
                        diag.type === "error"
                          ? "bg-red-500/10 border-red-500/20 text-red-400"
                          : "bg-yellow-500/10 border-yellow-500/20 text-yellow-400"
                      }`}
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        <span className="uppercase text-[10px] px-1.5 py-0.2 rounded bg-black/20">
                          {t(diag.type === "error" ? "extension.diagnosticError" : "extension.diagnosticWarning")}
                        </span>
                        {diag.path && <span className="font-mono">{diag.path}</span>}
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed">{diag.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-3 border-t border-divider bg-bg-elevated shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-control bg-bg-elevated border border-border text-text hover:bg-bg-hover transition-colors text-[12px] cursor-pointer"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
