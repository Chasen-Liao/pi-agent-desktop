"use client";

import { useEffect, useState } from "react";
import { apiJson } from "./apiJson";
import { useI18n } from "./I18nProvider";

export function CodemodeConfig() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiJson<{ codemodeEnabled?: boolean }>("/api/desktop-settings", undefined, { fallback: t("codemode.loadFailed") })
      .then((settings) => { if (!cancelled) { setEnabled(settings.codemodeEnabled ?? false); setLoaded(true); } })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : t("codemode.loadFailed")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [t]);

  const toggle = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await apiJson<{ codemodeEnabled: boolean }>("/api/desktop-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codemodeEnabled: !enabled }),
      }, { fallback: t("codemode.saveFailed") });
      setEnabled(saved.codemodeEnabled);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("codemode.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 flex flex-col gap-4 text-[13px]">
      <section className="p-4 rounded-panel border border-border bg-bg-panel">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 id="codemode-label" className="font-semibold text-text">{t("codemode.title")}</h4>
            <p className="mt-1 text-text-muted text-[12px]">{t("codemode.subtitle")}</p>
          </div>
          <button type="button" role="switch" aria-checked={enabled} aria-labelledby="codemode-label"
            aria-describedby="codemode-timing" disabled={!loaded || loading || saving} onClick={toggle}
            className="min-h-11 min-w-20 shrink-0 px-3 rounded-control border border-border bg-bg-elevated text-text hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 disabled:cursor-wait">
            {loading ? t("common.loading") : saving ? t("codemode.saving") : enabled ? t("common.enabled") : t("common.disabled")}
          </button>
        </div>
        <p id="codemode-timing" className="mt-3 text-[12px] leading-relaxed text-text-muted">{t("codemode.timing")}</p>
        {error && <p role="alert" className="mt-3 text-red-400">{error}</p>}
      </section>
      <section className="p-4 rounded-panel border border-border leading-relaxed">
        <h4 className="font-semibold text-text">{t("codemode.what")}</h4>
        <p className="mt-2 text-text-muted">{t("codemode.description")}</p>
        <p className="mt-3 text-text-muted">{t("codemode.example")}</p>
        <p className="mt-3 text-text-muted">{t("codemode.permissions")}</p>
      </section>
    </div>
  );
}
