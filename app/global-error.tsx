"use client";

// Next.js global-error convention: when this boundary activates it REPLACES
// the whole root layout, so it must render its own <html>/<body>, cannot rely
// on globals.css, and cannot consume the i18n context provider (which lives
// inside the layout it replaced). It is the last line of defense when the
// crash originates in the layout/provider itself — without it the window
// stays permanently blank (white-screen fix, see app/error.tsx for the
// in-layout boundary).
// Word lookup therefore goes through the context-free translate() helper from
// lib/i18n, and the locale is resolved from the same localStorage key the
// provider uses. All styling is embedded below (no globals.css).
import { useEffect, useState } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  normalizePreference,
  resolveLocale,
  translate,
  type Locale,
} from "@/lib/i18n";

const THEME_STORAGE_KEY = "pi-theme";

// Same contract as the inline script in app/layout.tsx (only "dark" maps to
// the dark class). toggle() also clears a stale class if the old document
// element survived the crash.
const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");document.documentElement.classList.toggle("dark",t==="dark")}catch(e){}})();`;

// Minimal mirror of the app/globals.css palette tokens (light + html.dark),
// self-contained so the error document renders correctly on its own.
const globalStyles = `
  :root {
    --pge-bg: #f8f9fc;
    --pge-panel: #ffffff;
    --pge-border: rgba(0, 0, 0, 0.08);
    --pge-text: #364152;
    --pge-text-strong: #182230;
    --pge-text-muted: #64748b;
    --pge-accent: #ff8f40;
    --pge-accent-hover: #f27d2f;
    --pge-accent-contrast: #ffffff;
    --pge-danger: #d95757;
    --pge-danger-bg: rgba(217, 87, 87, 0.1);
    --pge-danger-border: rgba(217, 87, 87, 0.32);
    --pge-shadow: 0 12px 40px rgba(15, 23, 42, 0.16);
    color-scheme: light;
  }
  html.dark {
    --pge-bg: #050505;
    --pge-panel: #0c1118;
    --pge-border: rgba(255, 255, 255, 0.08);
    --pge-text: #d9deea;
    --pge-text-strong: #f0f3f8;
    --pge-text-muted: #a7b0c0;
    --pge-accent: #ffb454;
    --pge-accent-hover: #ffd173;
    --pge-accent-contrast: #1b1307;
    --pge-danger: #ff8f8f;
    --pge-danger-bg: rgba(255, 143, 143, 0.08);
    --pge-danger-border: rgba(255, 143, 143, 0.28);
    --pge-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--pge-bg);
    color: var(--pge-text);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .pge-panel {
    width: 100%;
    max-width: 28rem;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px;
    border: 1px solid var(--pge-border);
    border-radius: 12px;
    background: var(--pge-panel);
    box-shadow: var(--pge-shadow);
  }
  .pge-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--pge-text-strong);
  }
  .pge-description {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.6;
    color: var(--pge-text-muted);
  }
  .pge-message {
    margin: 0;
    max-height: 10rem;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    padding: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.75rem;
    color: var(--pge-danger);
    background: var(--pge-danger-bg);
    border: 1px solid var(--pge-danger-border);
    border-radius: 8px;
  }
  .pge-digest {
    margin: 0;
    font-size: 0.75rem;
    color: var(--pge-text-muted);
    opacity: 0.75;
  }
  .pge-footer { display: flex; justify-content: flex-end; }
  .pge-button {
    cursor: pointer;
    padding: 6px 12px;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--pge-accent-contrast);
    background: var(--pge-accent);
    border: none;
    border-radius: 8px;
    transition: background-color 0.15s ease;
  }
  .pge-button:hover { background: var(--pge-accent-hover); }
`;

// Context-free locale detection: mirrors the i18n provider's hydration logic
// (stored preference, then browser languages, then default) without React
// context, which is unavailable outside the replaced layout.
function detectLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const preference = normalizePreference(localStorage.getItem(LOCALE_STORAGE_KEY));
    const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
    return resolveLocale(preference, languages);
  } catch {
    return DEFAULT_LOCALE;
  }
}

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // Resolve after mount: keeps SSR markup stable (default locale) and avoids
  // a hydration mismatch, mirroring the provider's own hydration behavior.
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    setLocale(detectLocale());
    console.error("[global-error-boundary]", error);
  }, [error]);

  return (
    // suppressHydrationWarning: the theme script above mutates <html> before
    // hydration, exactly like app/layout.tsx.
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style dangerouslySetInnerHTML={{ __html: globalStyles }} />
      </head>
      <body>
        <div className="pge-panel">
          <h2 className="pge-title">{translate(locale, "error.title")}</h2>
          <p className="pge-description">{translate(locale, "error.description")}</p>
          <pre className="pge-message">{error.message}</pre>
          {error.digest ? (
            <p className="pge-digest">
              {translate(locale, "error.digest", { digest: error.digest })}
            </p>
          ) : null}
          <div className="pge-footer">
            <button type="button" onClick={() => retry()} className="pge-button">
              {translate(locale, "error.reload")}
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
