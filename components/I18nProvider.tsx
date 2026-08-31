"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  normalizePreference,
  resolveLocale,
  translate,
  type Locale,
  type LocalePreference,
  type TranslationKey,
  type TranslationValues,
} from "@/lib/i18n";

interface I18nContextValue {
  locale: Locale;
  preference: LocalePreference;
  setPreference: (preference: LocalePreference) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LocalePreference>("system");
  const [hydrated, setHydrated] = useState(false);
  const [systemRevision, setSystemRevision] = useState(0);

  useEffect(() => {
    try {
      setPreferenceState(normalizePreference(localStorage.getItem(LOCALE_STORAGE_KEY)));
    } catch {
      setPreferenceState("system");
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    const refreshSystemLocale = () => setSystemRevision((revision) => revision + 1);
    const syncStorage = (event: StorageEvent) => {
      if (event.key === LOCALE_STORAGE_KEY) {
        setPreferenceState(normalizePreference(event.newValue));
      }
    };
    window.addEventListener("languagechange", refreshSystemLocale);
    window.addEventListener("storage", syncStorage);
    return () => {
      window.removeEventListener("languagechange", refreshSystemLocale);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  const locale = useMemo(() => {
    void systemRevision; // Invalidate the browser-language snapshot after languagechange.
    if (!hydrated) return DEFAULT_LOCALE;
    return resolveLocale(preference, browserLanguages());
  }, [hydrated, preference, systemRevision]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = "ltr";
  }, [locale]);

  const setPreference = useCallback((next: LocalePreference) => {
    const normalized = normalizePreference(next);
    setPreferenceState(normalized);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, normalized);
    } catch {
      // Storage can be unavailable in private browsing or restricted webviews.
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values),
    [locale],
  );
  const formatNumber = useCallback(
    (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale, options).format(value),
    [locale],
  );
  const formatDate = useCallback(
    (value: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, options).format(new Date(value)),
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, preference, setPreference, t, formatNumber, formatDate }),
    [locale, preference, setPreference, t, formatNumber, formatDate],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}

export const i18nServerFallback = {
  locale: DEFAULT_LOCALE,
};
