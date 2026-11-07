"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { ModalSurface } from "./ModalSurface";
import { CodemodeConfig } from "./CodemodeConfig";
import { useI18n } from "./I18nProvider";
import { apiJson } from "./apiJson";
import type { AgentMode, ToolPreset } from "@/lib/approval-policy";
import type { CloseAction, DesktopSettings } from "@/lib/desktop-settings";
import type { UpdateStatusPayload } from "@/electron/update-install-gate";

export type SettingsTab = "general" | "agent" | "about";

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
  isDark: boolean;
  onToggleTheme: (origin?: { x: number; y: number }) => void;
  onOpenModels: () => void;
  onOpenSkills: () => void;
  onOpenExtensions: () => void;
  canOpenSkills: boolean;
  autoCheckOnOpen?: boolean;
  onAutoCheckHandled?: () => void;
  onDesktopSettingsChange?: (settings: DesktopSettings) => void;
}

interface ElectronUpdaterWindow extends Window {
  electronAPI?: {
    getAppInfo?: () => Promise<{ version: string; isPackaged: boolean; platform: string }>;
    getUpdateStatus?: () => Promise<UpdateStatusPayload>;
    checkForUpdates?: () => Promise<UpdateStatusPayload>;
    downloadUpdate?: () => Promise<{ ok: boolean; error?: string }>;
    onUpdateStatus?: (cb: (status: UpdateStatusPayload) => void) => () => void;
    quitAndInstall?: () => Promise<{ ok: boolean; version?: string | null; error?: string }>;
    setCloseAction?: (action: "tray" | "quit") => void;
  };
}

const DEFAULT_REPO_URL = "https://github.com/Chasen-Liao/pi-agent-desktop";

/** Modal dialog for configuring appearance, window/chat behavior, agent defaults, and software updates. */
export function SettingsModal({
  isOpen,
  onClose,
  initialTab = "general",
  isDark,
  onToggleTheme,
  onOpenModels,
  onOpenSkills,
  onOpenExtensions,
  canOpenSkills,
  autoCheckOnOpen = false,
  onAutoCheckHandled,
  onDesktopSettingsChange,
}: SettingsModalProps) {
  const { t, preference: localePreference, setPreference: setLocalePreference } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const onDesktopSettingsChangeRef = useRef(onDesktopSettingsChange);
  onDesktopSettingsChangeRef.current = onDesktopSettingsChange;
  const settingsRevisionRef = useRef(0);

  // Desktop & agent settings state
  const [defaultAgentMode, setDefaultAgentMode] = useState<AgentMode>("full");
  const [defaultToolPreset, setDefaultToolPreset] = useState<ToolPreset>("default");
  const [closeAction, setCloseAction] = useState<CloseAction>("tray");
  const [followStreaming, setFollowStreaming] = useState<boolean>(true);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // App info & update state
  const [appVersion, setAppVersion] = useState<string>("0.13.0");
  const [appPlatform, setAppPlatform] = useState<string>("");
  const [repoUrl, setRepoUrl] = useState<string>(DEFAULT_REPO_URL);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusPayload>({
    status: "idle",
    currentVersion: "0.13.0",
    availableVersion: null,
    downloadedVersion: null,
    percent: null,
    transferred: null,
    total: null,
    error: null,
    checkedAt: null,
  });

  const loadDesktopSettings = useCallback(async () => {
    const revision = settingsRevisionRef.current;
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const data = await apiJson<DesktopSettings>("/api/desktop-settings", undefined, {
        fallback: t("settings.agent.loadFailed"),
      });
      if (revision !== settingsRevisionRef.current) return;
      const nextCloseAction = data.closeAction ?? "tray";
      const nextFollowStreaming = data.followStreaming ?? true;
      setDefaultAgentMode(data.defaultAgentMode ?? "full");
      setDefaultToolPreset(data.defaultToolPreset ?? "default");
      setCloseAction(nextCloseAction);
      setFollowStreaming(nextFollowStreaming);
    } catch (err: unknown) {
      if (revision !== settingsRevisionRef.current) return;
      setSettingsError(err instanceof Error ? err.message : t("settings.agent.loadFailed"));
    } finally {
      if (revision === settingsRevisionRef.current) {
        setSettingsLoading(false);
      }
    }
  }, [t]);

  const loadAppAndUpdateInfo = useCallback(async () => {
    const win = window as ElectronUpdaterWindow;
    if (win.electronAPI?.getAppInfo) {
      try {
        const info = await win.electronAPI.getAppInfo();
        setAppVersion(info.version);
        setAppPlatform(info.platform);
      } catch {
        // Fallback to web API below
      }
    }
    if (win.electronAPI?.getUpdateStatus) {
      try {
        const status = await win.electronAPI.getUpdateStatus();
        setUpdateStatus(status);
        if (status.currentVersion) {
          setAppVersion(status.currentVersion);
        }
      } catch {
        // Ignore IPC error
      }
    }
    try {
      const webInfo = await apiJson<{ version?: string; homepage?: string; platform?: string }>(
        "/api/app-info",
        undefined,
        { fallback: "Failed to load app info" }
      );
      if (webInfo.version) setAppVersion(webInfo.version);
      if (webInfo.platform) {
        setAppPlatform((prev) => prev || webInfo.platform!);
      }
      if (webInfo.homepage && /^https?:\/\//i.test(webInfo.homepage)) {
        setRepoUrl(webInfo.homepage.replace(/\/+$/, ""));
      }
    } catch {
      // Keep default version
    }
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    const win = window as ElectronUpdaterWindow;
    if (!win.electronAPI?.checkForUpdates) {
      setUpdateStatus((prev) => ({
        ...prev,
        status: "unsupported",
        error: null,
        checkedAt: Date.now(),
      }));
      return;
    }
    setUpdateStatus((prev) => {
      if (
        prev.status === "downloaded" ||
        prev.status === "downloading" ||
        prev.status === "checking"
      ) {
        return prev;
      }
      return {
        ...prev,
        status: "checking",
        error: null,
        checkedAt: Date.now(),
      };
    });
    try {
      const next = await win.electronAPI.checkForUpdates();
      if (next) {
        setUpdateStatus(next);
      }
    } catch (err: unknown) {
      setUpdateStatus((prev) => ({
        ...prev,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        checkedAt: Date.now(),
      }));
    }
  }, []);

  const handleDownloadUpdate = useCallback(async () => {
    const win = window as ElectronUpdaterWindow;
    if (!win.electronAPI?.downloadUpdate) return;
    setUpdateStatus((prev) => ({
      ...prev,
      status: "downloading",
      percent: prev.percent ?? 0,
      error: null,
    }));
    const result = await win.electronAPI.downloadUpdate();
    if (!result.ok && result.error) {
      setUpdateStatus((prev) => ({
        ...prev,
        status: "error",
        error: result.error ?? null,
      }));
    }
  }, []);

  const handleQuitAndInstall = useCallback(async () => {
    const win = window as ElectronUpdaterWindow;
    if (!win.electronAPI?.quitAndInstall) return;
    await win.electronAPI.quitAndInstall();
  }, []);

  useEffect(() => {
    const win = window as ElectronUpdaterWindow;
    if (!win.electronAPI?.onUpdateStatus) return;
    return win.electronAPI.onUpdateStatus((status) => {
      setUpdateStatus(status);
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    void loadDesktopSettings();
    void loadAppAndUpdateInfo();
  }, [isOpen, loadDesktopSettings, loadAppAndUpdateInfo]);

  useEffect(() => {
    if (isOpen && autoCheckOnOpen) {
      onAutoCheckHandled?.();
      void handleCheckForUpdates();
    }
  }, [isOpen, autoCheckOnOpen, onAutoCheckHandled, handleCheckForUpdates]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const updateAgentSetting = async (patch: Partial<DesktopSettings>) => {
    const revision = ++settingsRevisionRef.current;
    setSettingsLoading(false);
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const saved = await apiJson<DesktopSettings>(
        "/api/desktop-settings",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
        { fallback: t("settings.agent.saveFailed") }
      );
      if (revision !== settingsRevisionRef.current) return;
      const nextCloseAction = saved.closeAction ?? "tray";
      const nextFollowStreaming = saved.followStreaming ?? true;
      setDefaultAgentMode(saved.defaultAgentMode);
      setDefaultToolPreset(saved.defaultToolPreset);
      setCloseAction(nextCloseAction);
      setFollowStreaming(nextFollowStreaming);
      const win = window as ElectronUpdaterWindow;
      win.electronAPI?.setCloseAction?.(nextCloseAction);
      onDesktopSettingsChangeRef.current?.(saved);
    } catch (err: unknown) {
      if (revision !== settingsRevisionRef.current) return;
      setSettingsError(err instanceof Error ? err.message : t("settings.agent.saveFailed"));
    } finally {
      if (revision === settingsRevisionRef.current) {
        setSettingsSaving(false);
      }
    }
  };

  const tabs: { id: SettingsTab; label: string; badge?: boolean }[] = [
    { id: "general", label: t("settings.tab.general") },
    { id: "agent", label: t("settings.tab.agent") },
    {
      id: "about",
      label: t("settings.tab.about"),
      badge: updateStatus.status === "available" || updateStatus.status === "downloaded",
    },
  ];

  const renderUpdateStatusText = () => {
    switch (updateStatus.status) {
      case "checking":
        return t("settings.about.checking");
      case "not-available":
        return t("settings.about.upToDate", { version: appVersion });
      case "available":
        return t("settings.about.available", {
          version: updateStatus.availableVersion ?? appVersion,
        });
      case "downloading":
        return t("settings.about.downloading", {
          percent: Math.round(updateStatus.percent ?? 0),
        });
      case "downloaded":
        return t("settings.about.downloaded", {
          version: updateStatus.downloadedVersion ?? updateStatus.availableVersion ?? appVersion,
        });
      case "unsupported":
        return t("settings.about.unsupported");
      case "error":
        return t("settings.about.error", { error: updateStatus.error ?? "Unknown error" });
      default:
        return t("settings.about.idleHint");
    }
  };

  return (
    <ModalSurface
      panelClassName="t-modal is-open ui-dialog-surface w-full max-w-3xl h-[78vh] max-h-[680px] rounded-[14px] flex flex-col overflow-hidden"
      ariaLabelledBy="settings-modal-title"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider bg-bg-elevated shrink-0">
        <h3 id="settings-modal-title" className="font-semibold text-text text-[14px]">
          {t("settings.title")}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="text-text-muted hover:text-text text-[16px] leading-none px-2 py-1 rounded-control transition-[color,background-color,transform] duration-150 hover:bg-bg-hover active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* Tabs Bar */}
      <div
        role="tablist"
        aria-label={t("settings.title")}
        className="flex items-center border-b border-divider bg-bg-elevated px-4 gap-1 shrink-0"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`settings-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`settings-panel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-[12px] font-medium border-b-2 transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 cursor-pointer flex items-center gap-1.5 ${
              activeTab === tab.id
                ? "border-accent text-accent bg-bg"
                : "border-transparent text-text-muted hover:text-text hover:bg-bg-hover"
            }`}
          >
            <span>{tab.label}</span>
            {tab.badge && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-accent shrink-0"
                aria-hidden="true"
              />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div
        id={`settings-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`settings-tab-${activeTab}`}
        className="flex-1 overflow-y-auto min-h-0"
      >
        {activeTab === "general" && (
          <div className="p-4 flex flex-col gap-4 text-[13px]">
            {/* Appearance & Language */}
            <section className="p-4 rounded-panel border border-border bg-bg-panel flex flex-col gap-4">
              <h4 className="font-semibold text-text">{t("settings.appearance.title")}</h4>

              {/* Theme Row */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-text">{t("settings.appearance.theme")}</div>
                  <div className="mt-0.5 text-[12px] text-text-muted">
                    {t("settings.appearance.themeDesc")}
                  </div>
                </div>
                <div className="inline-flex rounded-control border border-border bg-bg-elevated p-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      if (isDark) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        onToggleTheme({
                          x: rect.left + rect.width / 2,
                          y: rect.top + rect.height / 2,
                        });
                      }
                    }}
                    className={`px-3 py-1 rounded-[5px] text-[12px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 cursor-pointer ${
                      !isDark
                        ? "bg-accent text-accent-contrast"
                        : "text-text-muted hover:text-text"
                    }`}
                  >
                    {t("settings.appearance.light")}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      if (!isDark) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        onToggleTheme({
                          x: rect.left + rect.width / 2,
                          y: rect.top + rect.height / 2,
                        });
                      }
                    }}
                    className={`px-3 py-1 rounded-[5px] text-[12px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 cursor-pointer ${
                      isDark
                        ? "bg-accent text-accent-contrast"
                        : "text-text-muted hover:text-text"
                    }`}
                  >
                    {t("settings.appearance.dark")}
                  </button>
                </div>
              </div>

              <div className="border-t border-divider" />

              {/* Language Row */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-text">{t("language.label")}</div>
                  <div className="mt-0.5 text-[12px] text-text-muted">
                    {t("settings.appearance.languageDesc")}
                  </div>
                </div>
                <select
                  value={localePreference}
                  onChange={(e) =>
                    setLocalePreference(e.target.value as "system" | "en" | "zh-CN")
                  }
                  aria-label={t("language.label")}
                  className="min-w-36 rounded-control border border-border bg-bg-elevated px-2.5 py-1.5 text-[12px] text-text outline-none focus:border-focus-ring transition-colors duration-150 motion-reduce:transition-none"
                >
                  <option value="system">{t("language.system")}</option>
                  <option value="en">{t("language.english")}</option>
                  <option value="zh-CN">{t("language.chineseSimplified")}</option>
                </select>
              </div>
            </section>

            {/* Window & Chat Behavior */}
            <section className="p-4 rounded-panel border border-border bg-bg-panel flex flex-col gap-4">
              <h4 className="font-semibold text-text">{t("settings.window.title")}</h4>

              {settingsError && (
                <p role="alert" className="text-[12px] text-danger">
                  {settingsError}
                </p>
              )}

              {/* Close Button Behavior Row */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-text">{t("settings.window.closeAction")}</div>
                  <div className="mt-0.5 text-[12px] text-text-muted">
                    {t("settings.window.closeActionDesc")}
                  </div>
                </div>
                <div className="inline-flex rounded-control border border-border bg-bg-elevated p-0.5 shrink-0">
                  {(
                    [
                      { id: "tray", label: t("settings.window.closeToTray") },
                      { id: "quit", label: t("settings.window.closeQuit") },
                    ] as { id: CloseAction; label: string }[]
                  ).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      disabled={settingsLoading || settingsSaving}
                      onClick={() => void updateAgentSetting({ closeAction: option.id })}
                      className={`px-3 py-1 rounded-[5px] text-[12px] font-medium transition-[background-color,color,transform] duration-150 enabled:active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 cursor-pointer disabled:opacity-50 ${
                        closeAction === option.id
                          ? "bg-accent text-accent-contrast"
                          : "text-text-muted hover:text-text"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-divider" />

              {/* Follow Streaming Answer Row */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-text">
                    {t("settings.window.followStreaming")}
                  </div>
                  <div className="mt-0.5 text-[12px] text-text-muted">
                    {t("settings.window.followStreamingDesc")}
                  </div>
                </div>
                <div className="inline-flex rounded-control border border-border bg-bg-elevated p-0.5 shrink-0">
                  {(
                    [
                      { value: true, label: t("settings.window.followStreamingOn") },
                      { value: false, label: t("settings.window.followStreamingOff") },
                    ] as { value: boolean; label: string }[]
                  ).map((option) => (
                    <button
                      key={String(option.value)}
                      type="button"
                      disabled={settingsLoading || settingsSaving}
                      onClick={() => void updateAgentSetting({ followStreaming: option.value })}
                      className={`px-3 py-1 rounded-[5px] text-[12px] font-medium transition-[background-color,color,transform] duration-150 enabled:active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 cursor-pointer disabled:opacity-50 ${
                        followStreaming === option.value
                          ? "bg-accent text-accent-contrast"
                          : "text-text-muted hover:text-text"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Quick Configuration Shortcuts */}
            <section className="p-4 rounded-panel border border-border bg-bg-panel flex flex-col gap-3">
              <div>
                <h4 className="font-semibold text-text">{t("settings.shortcuts.title")}</h4>
                <p className="mt-0.5 text-[12px] text-text-muted">
                  {t("settings.shortcuts.desc")}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenModels();
                  }}
                  className="flex items-center justify-between p-3 rounded-control border border-border bg-bg-elevated hover:bg-bg-hover transition-[background-color,border-color,transform] duration-150 enabled:active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 text-left cursor-pointer"
                >
                  <span className="font-medium text-text text-[12px]">
                    {t("shell.models")}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    {t("settings.shortcuts.open")} →
                  </span>
                </button>

                <button
                  type="button"
                  disabled={!canOpenSkills}
                  onClick={() => {
                    onClose();
                    onOpenSkills();
                  }}
                  className="flex items-center justify-between p-3 rounded-control border border-border bg-bg-elevated hover:bg-bg-hover transition-[background-color,border-color,transform] duration-150 enabled:active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 text-left cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <span className="font-medium text-text text-[12px]">
                    {t("shell.skills")}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    {t("settings.shortcuts.open")} →
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenExtensions();
                  }}
                  className="flex items-center justify-between p-3 rounded-control border border-border bg-bg-elevated hover:bg-bg-hover transition-[background-color,border-color,transform] duration-150 enabled:active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 text-left cursor-pointer"
                >
                  <span className="font-medium text-text text-[12px]">
                    {t("shell.extensionsMcp")}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    {t("settings.shortcuts.open")} →
                  </span>
                </button>
              </div>
            </section>
          </div>
        )}

        {activeTab === "agent" && (
          <div className="flex flex-col">
            <div className="px-4 pt-4">
              <section className="p-4 rounded-panel border border-border bg-bg-panel flex flex-col gap-4 text-[13px]">
                <div>
                  <h4 className="font-semibold text-text">
                    {t("settings.agent.defaultsTitle")}
                  </h4>
                  <p className="mt-0.5 text-[12px] text-text-muted">
                    {t("settings.agent.defaultsDesc")}
                  </p>
                </div>

                {settingsError && (
                  <p role="alert" className="text-[12px] text-danger">
                    {settingsError}
                  </p>
                )}

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-text">
                      {t("settings.agent.defaultMode")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-text-muted">
                      {defaultAgentMode === "plan"
                        ? t("agentMode.plan.desc")
                        : defaultAgentMode === "ask"
                        ? t("agentMode.ask.desc")
                        : t("agentMode.full.desc")}
                    </div>
                  </div>
                  <div className="inline-flex rounded-control border border-border bg-bg-elevated p-0.5 shrink-0">
                    {(["plan", "ask", "full"] as AgentMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={settingsLoading || settingsSaving}
                        onClick={() => void updateAgentSetting({ defaultAgentMode: mode })}
                        className={`px-3 py-1 rounded-[5px] text-[12px] font-medium transition-[background-color,color,transform] duration-150 enabled:active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 cursor-pointer disabled:opacity-50 ${
                          defaultAgentMode === mode
                            ? "bg-accent text-accent-contrast"
                            : "text-text-muted hover:text-text"
                        }`}
                      >
                        {t(`agentMode.${mode}.label` as const)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-divider" />

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-text">
                      {t("settings.agent.defaultTools")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-text-muted">
                      {defaultToolPreset === "none"
                        ? t("toolPreset.off.desc")
                        : defaultToolPreset === "default"
                        ? t("toolPreset.default.desc")
                        : t("toolPreset.full.desc")}
                    </div>
                  </div>
                  <div className="inline-flex rounded-control border border-border bg-bg-elevated p-0.5 shrink-0">
                    {(
                      [
                        { id: "none", label: t("toolPreset.off") },
                        { id: "default", label: t("toolPreset.default") },
                        { id: "full", label: t("toolPreset.full") },
                      ] as { id: ToolPreset; label: string }[]
                    ).map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        disabled={settingsLoading || settingsSaving}
                        onClick={() =>
                          void updateAgentSetting({ defaultToolPreset: preset.id })
                        }
                        className={`px-3 py-1 rounded-[5px] text-[12px] font-medium transition-[background-color,color,transform] duration-150 enabled:active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 cursor-pointer disabled:opacity-50 ${
                          defaultToolPreset === preset.id
                            ? "bg-accent text-accent-contrast"
                            : "text-text-muted hover:text-text"
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            <CodemodeConfig />
          </div>
        )}

        {activeTab === "about" && (
          <div className="p-4 flex flex-col gap-4 text-[13px]">
            {/* App Summary Card */}
            <section className="p-4 rounded-panel border border-border bg-bg-panel flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="font-semibold text-text text-[14px]">
                    {t("settings.about.appName")}
                  </h4>
                  <p className="mt-0.5 text-[12px] text-text-muted">
                    {t("settings.about.subtitle")}
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-control border border-border bg-bg-elevated font-mono text-[12px] text-text tabular-nums">
                  v{appVersion}
                </span>
              </div>

              <div className="border-t border-divider pt-3 grid grid-cols-2 gap-3 text-[12px]">
                <div>
                  <span className="text-text-muted">{t("settings.about.version")}: </span>
                  <span className="font-mono text-text tabular-nums">v{appVersion}</span>
                </div>
                {appPlatform && (
                  <div>
                    <span className="text-text-muted">{t("settings.about.platform")}: </span>
                    <span className="font-mono text-text">{appPlatform}</span>
                  </div>
                )}
              </div>
            </section>

            {/* Software Updates Card */}
            <section className="p-4 rounded-panel border border-border bg-bg-panel flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-text">
                    {t("settings.about.updatesTitle")}
                  </h4>
                  <p
                    key={updateStatus.status}
                    className={`mt-1 text-[12px] transition-[opacity,filter] duration-150 motion-reduce:transition-none ${
                      updateStatus.status === "error"
                        ? "text-danger"
                        : updateStatus.status === "available" ||
                          updateStatus.status === "downloaded"
                        ? "text-accent font-medium"
                        : "text-text-muted"
                    }`}
                  >
                    {renderUpdateStatusText()}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {updateStatus.status === "available" && (
                    <button
                      type="button"
                      onClick={() => void handleDownloadUpdate()}
                      className="px-3 py-1.5 rounded-control bg-accent text-accent-contrast font-medium text-[12px] transition-[opacity,transform] duration-150 hover:opacity-90 enabled:active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 cursor-pointer"
                    >
                      {t("settings.about.downloadAction")}
                    </button>
                  )}

                  {updateStatus.status === "downloaded" && (
                    <button
                      type="button"
                      onClick={() => void handleQuitAndInstall()}
                      className="px-3 py-1.5 rounded-control bg-accent text-accent-contrast font-medium text-[12px] transition-[opacity,transform] duration-150 hover:opacity-90 enabled:active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 cursor-pointer"
                    >
                      {t("settings.about.restartAction")}
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={
                      updateStatus.status === "checking" ||
                      updateStatus.status === "downloading" ||
                      updateStatus.status === "downloaded"
                    }
                    onClick={() => void handleCheckForUpdates()}
                    className="px-3 py-1.5 rounded-control border border-border bg-bg-elevated text-text font-medium text-[12px] transition-[background-color,border-color,transform] duration-150 hover:bg-bg-hover enabled:active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {updateStatus.status === "checking"
                      ? t("settings.about.checking")
                      : t("settings.about.checkNow")}
                  </button>
                </div>
              </div>

              {updateStatus.status === "downloading" && (
                <div className="w-full h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                  <div
                    className="h-full bg-accent origin-left transition-transform duration-150 ease-out motion-reduce:transition-none"
                    style={{
                      transform: `scaleX(${Math.max(
                        0,
                        Math.min(1, (updateStatus.percent ?? 0) / 100)
                      )})`,
                    }}
                  />
                </div>
              )}
            </section>

            {/* External Links */}
            <section className="p-4 rounded-panel border border-border bg-bg-panel flex flex-col gap-3">
              <h4 className="font-semibold text-text">{t("settings.about.linksTitle")}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-3 rounded-control border border-border bg-bg-elevated hover:bg-bg-hover transition-[background-color,border-color,transform] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 text-[12px] text-text no-underline"
                >
                  <span>{t("settings.about.githubRepo")}</span>
                  <span className="text-text-muted">↗</span>
                </a>
                <a
                  href={`${repoUrl}/releases`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-3 rounded-control border border-border bg-bg-elevated hover:bg-bg-hover transition-[background-color,border-color,transform] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 text-[12px] text-text no-underline"
                >
                  <span>{t("settings.about.releaseNotes")}</span>
                  <span className="text-text-muted">↗</span>
                </a>
                <a
                  href={`${repoUrl}/issues`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-3 rounded-control border border-border bg-bg-elevated hover:bg-bg-hover transition-[background-color,border-color,transform] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 text-[12px] text-text no-underline"
                >
                  <span>{t("settings.about.reportIssue")}</span>
                  <span className="text-text-muted">↗</span>
                </a>
              </div>
            </section>
          </div>
        )}
      </div>
    </ModalSurface>
  );
}
