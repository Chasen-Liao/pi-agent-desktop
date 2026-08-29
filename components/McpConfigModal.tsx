"use client";

import React, { useState, useEffect, useCallback } from "react";
import type { McpServerStatus, McpServerConfig } from "@/lib/mcp-config";
import { useI18n } from "./I18nProvider";

export interface McpConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  cwd?: string;
}

export interface McpConfigContentProps {
  cwd?: string;
}

export function McpConfigContent({ cwd }: McpConfigContentProps) {
  const { t } = useI18n();
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [editingServer, setEditingServer] = useState<Partial<McpServerStatus> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [formScope, setFormScope] = useState<"global" | "project">("project");
  const [formTransport, setFormTransport] = useState<"stdio" | "sse">("stdio");
  const [formId, setFormId] = useState("");
  const [formName, setFormName] = useState("");
  const [formCommand, setFormCommand] = useState("");
  const [formArgs, setFormArgs] = useState("");
  const [formEnv, setFormEnv] = useState("");
  const [formUrl, setFormUrl] = useState("");

  // Testing connection state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testingForm, setTestingForm] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message?: string;
    toolsCount?: number;
  } | null>(null);

  const fetchServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = cwd ? `/api/mcp?cwd=${encodeURIComponent(cwd)}` : "/api/mcp";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setServers(data.servers || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("mcp.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [cwd, t]);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const handleToggle = async (server: McpServerStatus) => {
    try {
      const res = await fetch("/api/mcp/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: server.id,
          scope: server.scope,
          disabled: !server.disabled,
          cwd,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchServers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("mcp.toggleFailed"));
    }
  };

  const handleDelete = async (server: McpServerStatus) => {
    if (!confirm(t("mcp.deleteConfirm", { name: server.name || server.id }))) return;
    try {
      const res = await fetch("/api/mcp", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: server.id,
          scope: server.scope,
          cwd,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fetchServers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("mcp.deleteFailed"));
    }
  };

  const handleTestServer = async (server: McpServerStatus) => {
    setTestingId(server.id);
    setTestResult(null);
    try {
      const res = await fetch("/api/mcp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: server.command,
          args: server.args,
          env: server.env,
          url: server.url,
        }),
      });
      const data = await res.json();
      setTestResult({
        success: data.success ?? false,
        message: data.message || (data.success
          ? t("mcp.connectedTools", { count: data.toolsCount ?? 0 })
          : t("mcp.connectionFailed")),
        toolsCount: data.toolsCount,
      });
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : t("mcp.testRequestFailed"),
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleTestFormServer = async () => {
    setTestingForm(true);
    setTestResult(null);
    try {
      let parsedEnv: Record<string, string> | undefined;
      if (formEnv.trim()) {
        parsedEnv = {};
        for (const line of formEnv.split("\n")) {
          const eqIndex = line.indexOf("=");
          if (eqIndex > 0) {
            const k = line.slice(0, eqIndex).trim();
            const v = line.slice(eqIndex + 1).trim();
            if (k) parsedEnv[k] = v;
          }
        }
      }

      const res = await fetch("/api/mcp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: formTransport === "stdio" ? formCommand.trim() : undefined,
          args: formTransport === "stdio" ? formArgs.split(/\s+/).filter(Boolean) : undefined,
          env: parsedEnv,
          url: formTransport === "sse" ? formUrl.trim() : undefined,
        }),
      });
      const data = await res.json();
      setTestResult({
        success: data.success ?? false,
        message: data.message || (data.success
          ? t("mcp.connectionSucceeded", { count: data.toolsCount ?? 0 })
          : t("mcp.connectionFailed")),
        toolsCount: data.toolsCount,
      });
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : t("mcp.connectionTestFailed"),
      });
    } finally {
      setTestingForm(false);
    }
  };

  const openAddForm = () => {
    setIsNew(true);
    setEditingServer({});
    setFormScope("project");
    setFormTransport("stdio");
    setFormId("");
    setFormName("");
    setFormCommand("");
    setFormArgs("");
    setFormEnv("");
    setFormUrl("");
    setTestResult(null);
  };

  const openEditForm = (server: McpServerStatus) => {
    setIsNew(false);
    setEditingServer(server);
    setFormScope(server.scope);
    setFormTransport(server.transport || "stdio");
    setFormId(server.id);
    setFormName(server.name || "");
    setFormCommand(server.command || "");
    setFormArgs((server.args || []).join(" "));
    setFormEnv(
      server.env
        ? Object.entries(server.env)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")
        : ""
    );
    setFormUrl(server.url || "");
    setTestResult(null);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formId.trim()) {
      setError(t("mcp.serverIdRequired"));
      return;
    }

    let parsedEnv: Record<string, string> | undefined;
    if (formEnv.trim()) {
      parsedEnv = {};
      for (const line of formEnv.split("\n")) {
        const eqIndex = line.indexOf("=");
        if (eqIndex > 0) {
          const k = line.slice(0, eqIndex).trim();
          const v = line.slice(eqIndex + 1).trim();
          if (k) parsedEnv[k] = v;
        }
      }
    }

    const serverConfig: McpServerConfig = {
      id: formId.trim(),
      name: formName.trim() || undefined,
      transport: formTransport,
      command: formTransport === "stdio" ? formCommand.trim() || undefined : undefined,
      args: formTransport === "stdio" ? formArgs.split(/\s+/).filter(Boolean) : undefined,
      env: parsedEnv,
      url: formTransport === "sse" ? formUrl.trim() || undefined : undefined,
      disabled: editingServer?.disabled ?? false,
    };

    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: formScope,
          cwd,
          server: serverConfig,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setEditingServer(null);
      fetchServers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("mcp.saveFailed"));
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg text-text text-[13px]">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider bg-bg-elevated shrink-0">
        <div>
          <h3 className="font-semibold text-text text-[14px]">{t("mcp.servers")}</h3>
          <p className="text-[11px] text-text-muted">
            {t("mcp.description")}
          </p>
        </div>
        {!editingServer && (
          <button
            onClick={openAddForm}
            className="px-3 py-1.5 rounded-control bg-accent text-accent-contrast font-medium hover:opacity-90 transition-opacity cursor-pointer text-[12px]"
          >
            {t("mcp.addServer")}
          </button>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-control bg-red-500/10 border border-red-500/20 text-red-400 text-[12px] flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 font-bold ml-2">
            ×
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4">
        {editingServer ? (
          /* Add / Edit Form */
          <form onSubmit={handleSaveForm} className="flex flex-col gap-3 max-w-xl mx-auto bg-bg-panel p-4 rounded-panel border border-border">
            <h4 className="font-semibold text-text text-[13px] border-b border-divider pb-2">
              {isNew ? t("mcp.addTitle") : t("mcp.editTitle", { id: editingServer.id ?? "" })}
            </h4>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  {t("mcp.serverId")}
                </label>
                <input
                  type="text"
                  value={formId}
                  onChange={(e) => setFormId(e.target.value)}
                  disabled={!isNew}
                  placeholder="e.g. github"
                  className="w-full px-2.5 py-1.5 rounded-control bg-bg border border-border text-text font-mono text-[12px] focus:outline-none focus:border-accent disabled:opacity-50"
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  {t("mcp.displayName")}
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. GitHub MCP"
                  className="w-full px-2.5 py-1.5 rounded-control bg-bg border border-border text-text text-[12px] focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  {t("mcp.scope")}
                </label>
                <select
                  value={formScope}
                  onChange={(e) => setFormScope(e.target.value as "global" | "project")}
                  className="w-full px-2.5 py-1.5 rounded-control bg-bg border border-border text-text text-[12px] focus:outline-none focus:border-accent"
                >
                  <option value="project">{t("scope.project")} (.pi/mcp.json)</option>
                  <option value="global">{t("scope.global")} (~/.pi/agent/mcp.json)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  {t("mcp.transport")}
                </label>
                <select
                  value={formTransport}
                  onChange={(e) => setFormTransport(e.target.value as "stdio" | "sse")}
                  className="w-full px-2.5 py-1.5 rounded-control bg-bg border border-border text-text text-[12px] focus:outline-none focus:border-accent"
                >
                  <option value="stdio">{t("mcp.stdioTransport")}</option>
                  <option value="sse">{t("mcp.sseTransport")}</option>
                </select>
              </div>
            </div>

            {formTransport === "stdio" ? (
              <>
                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    {t("mcp.command")}
                  </label>
                  <input
                    type="text"
                    value={formCommand}
                    onChange={(e) => setFormCommand(e.target.value)}
                    placeholder="e.g. npx or node"
                    className="w-full px-2.5 py-1.5 rounded-control bg-bg border border-border text-text font-mono text-[12px] focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    {t("mcp.arguments")}
                  </label>
                  <input
                    type="text"
                    value={formArgs}
                    onChange={(e) => setFormArgs(e.target.value)}
                    placeholder="e.g. -y @modelcontextprotocol/server-github"
                    className="w-full px-2.5 py-1.5 rounded-control bg-bg border border-border text-text font-mono text-[12px] focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-text-muted mb-1">
                    {t("mcp.environment")}
                  </label>
                  <textarea
                    value={formEnv}
                    onChange={(e) => setFormEnv(e.target.value)}
                    rows={3}
                    placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=ghp_..."
                    className="w-full px-2.5 py-1.5 rounded-control bg-bg border border-border text-text font-mono text-[12px] focus:outline-none focus:border-accent resize-y"
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-[11px] font-medium text-text-muted mb-1">
                  {t("mcp.endpoint")}
                </label>
                <input
                  type="url"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://mcp-server.example.com/sse"
                  className="w-full px-2.5 py-1.5 rounded-control bg-bg border border-border text-text font-mono text-[12px] focus:outline-none focus:border-accent"
                />
              </div>
            )}

            {/* Test connection output in form */}
            {testResult && (
              <div
                className={`p-2.5 rounded-control text-[12px] border ${
                  testResult.success
                    ? "bg-green-500/10 border-green-500/20 text-green-400"
                    : "bg-red-500/10 border-red-500/20 text-red-400"
                }`}
              >
                {testResult.message}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-divider mt-2">
              <button
                type="button"
                onClick={handleTestFormServer}
                disabled={testingForm}
                className="px-3 py-1.5 rounded-control border border-border text-text-muted hover:text-text hover:bg-bg-hover transition-colors cursor-pointer text-[12px] disabled:opacity-50"
              >
                {testingForm ? t("mcp.testing") : t("mcp.testConnection")}
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingServer(null);
                    setTestResult(null);
                  }}
                  className="px-3 py-1.5 rounded-control border border-border text-text-muted hover:text-text hover:bg-bg-hover transition-colors cursor-pointer text-[12px]"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-control bg-accent text-accent-contrast font-medium hover:opacity-90 transition-opacity cursor-pointer text-[12px]"
                >
                  {t("mcp.saveServer")}
                </button>
              </div>
            </div>
          </form>
        ) : loading ? (
          <div className="flex items-center justify-center h-40 text-text-muted text-[13px]">
            {t("mcp.loading")}
          </div>
        ) : servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-text-muted gap-2 border border-dashed border-border rounded-panel p-6">
            <span className="text-[14px]">{t("mcp.none")}</span>
            <p className="text-[12px] text-text-dim text-center max-w-sm">
              {t("mcp.noneHint")}
            </p>
            <button
              onClick={openAddForm}
              className="mt-2 px-3 py-1.5 rounded-control bg-accent text-accent-contrast text-[12px] font-medium hover:opacity-90"
            >
              {t("mcp.addFirst")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {testResult && (
              <div
                className={`p-2.5 rounded-control text-[12px] border ${
                  testResult.success
                    ? "bg-green-500/10 border-green-500/20 text-green-400"
                    : "bg-red-500/10 border-red-500/20 text-red-400"
                }`}
              >
                {testResult.message}
              </div>
            )}

            {servers.map((server) => {
              const isTesting = testingId === server.id;
              const isDisabled = server.disabled;

              return (
                <div
                  key={`${server.scope}-${server.id}`}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-panel border transition-[background-color,border-color,color] duration-150 ${
                    isDisabled
                      ? "bg-bg-panel/40 border-border/50 opacity-65"
                      : "bg-bg-panel border-border"
                  }`}
                >
                  <div className="flex flex-col gap-1 pr-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-text text-[13px]">
                        {server.name || server.id}
                      </span>
                      {server.name && (
                        <span className="font-mono text-[11px] text-text-dim">
                          ({server.id})
                        </span>
                      )}

                      {/* Scope Badge */}
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono border uppercase tracking-wider ${
                          server.scope === "global"
                            ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        }`}
                      >
                        {t(server.scope === "global" ? "scope.global" : "scope.project")}
                      </span>

                      {/* Transport Badge */}
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-bg-elevated text-text-dim border border-border">
                        {server.transport || "stdio"}
                      </span>

                      {/* Status Badge */}
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium border flex items-center gap-1 ${
                          isDisabled
                            ? "bg-gray-500/10 text-gray-400 border-gray-500/20"
                            : server.status === "connected"
                            ? "bg-green-500/10 text-green-400 border-green-500/20"
                            : server.status === "error"
                            ? "bg-red-500/10 text-red-400 border-red-500/20"
                            : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isDisabled
                              ? "bg-gray-400"
                              : server.status === "connected"
                              ? "bg-green-400"
                              : server.status === "error"
                              ? "bg-red-400"
                              : "bg-yellow-400"
                          }`}
                        />
                        {isDisabled
                          ? t("common.disabled")
                          : server.status === "connected"
                          ? `${t("common.connected")} ${server.toolsCount ? `(${t("common.toolsCount", { count: server.toolsCount })})` : ""}`
                          : server.status === "error"
                          ? t("common.error")
                          : t("common.disconnected")}
                      </span>
                    </div>

                    {/* Command / URL details */}
                    <div className="font-mono text-[11px] text-text-muted truncate max-w-lg mt-0.5">
                      {server.transport === "sse" ? (
                        <span>{server.url}</span>
                      ) : (
                        <span>
                          {server.command} {(server.args || []).join(" ")}
                        </span>
                      )}
                    </div>

                    {server.errorMessage && !isDisabled && (
                      <div className="text-[11px] text-red-400 mt-1">
                        {server.errorMessage}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-3 sm:mt-0 shrink-0">
                    <button
                      onClick={() => handleTestServer(server)}
                      disabled={isTesting || isDisabled}
                      className="px-2.5 py-1 rounded-control border border-border text-text-muted hover:text-text hover:bg-bg-hover transition-colors text-[11px] disabled:opacity-40 cursor-pointer"
                    >
                      {isTesting ? t("mcp.testing") : t("common.test")}
                    </button>
                    <button
                      onClick={() => handleToggle(server)}
                      className={`px-2.5 py-1 rounded-control text-[11px] font-medium transition-colors cursor-pointer border ${
                        isDisabled
                          ? "bg-accent/10 text-accent border-accent/30 hover:bg-accent/20"
                          : "bg-bg-elevated text-text-muted border-border hover:text-text"
                      }`}
                    >
                      {isDisabled ? t("common.enable") : t("common.disable")}
                    </button>
                    <button
                      onClick={() => openEditForm(server)}
                      className="px-2.5 py-1 rounded-control border border-border text-text-muted hover:text-text hover:bg-bg-hover transition-colors text-[11px] cursor-pointer"
                    >
                      {t("common.edit")}
                    </button>
                    <button
                      onClick={() => handleDelete(server)}
                      className="px-2.5 py-1 rounded-control border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors text-[11px] cursor-pointer"
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function McpConfigModal({ isOpen, onClose, cwd }: McpConfigModalProps) {
  const { t } = useI18n();
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("mcp.configuration")}
      className="ui-dialog-backdrop fixed inset-0 z-[1000] flex items-center justify-center p-4"
    >
      <div className="t-modal is-open ui-dialog-surface w-full max-w-3xl h-[80vh] max-h-[700px] rounded-[14px] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-divider bg-bg-elevated shrink-0">
          <span className="font-semibold text-text text-[14px]">{t("mcp.settings")}</span>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="text-text-muted hover:text-text text-[18px] leading-none px-2 py-1 cursor-pointer"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <McpConfigContent cwd={cwd} />
        </div>
      </div>
    </div>
  );
}
