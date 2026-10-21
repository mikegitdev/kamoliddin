import { createContext, useContext, useEffect, useState } from "react";
import { ru, type Dict } from "./ru";
import { uz } from "./uz";

export type Locale = "ru" | "uz";

const dictionaries: Record<Locale, Dict> = { ru, uz };

const TITLES: Record<Locale, string> = {
  ru: "Local Ads — карта рекламы Ташкента",
  uz: "Local Ads — Toshkent reklama xaritasi",
};

interface I18n {
  locale: Locale;
  t: Dict;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18n>({ locale: "ru", t: ru, setLocale: () => {} });

/** Plural word forms per locale: ru = [one, few, many], uz = [one, many]. */
const PLURAL_FORMS: Record<Locale, Record<"locations" | "ads" | "days" | "branches", [string, string, string?]>> = {
  ru: {
    locations: ["точка", "точки", "точек"],
    ads: ["объявление", "объявления", "объявлений"],
    days: ["день", "дня", "дней"],
    branches: ["точке", "точках", "точках"],
  },
  uz: {
    locations: ["joy", "joy"],
    ads: ["e'lon", "e'lon"],
    days: ["kun", "kun"],
    branches: ["nuqtada", "nuqtada"],
  },
};

export function plural(
  locale: Locale,
  kind: "locations" | "ads" | "days" | "branches",
  n: number,
): string {
  const forms = PLURAL_FORMS[locale][kind];
  if (locale === "uz") return forms[n === 1 ? 0 : 1] ?? forms[0];
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2] ?? forms[0];
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("locale");
    } catch {
      /* storage blocked (privacy mode): fall back to the default locale */
    }
    return saved === "uz" || saved === "ru" ? saved : "ru";
  });

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = TITLES[locale];
  }, [locale]);

  const setLocale = (next: Locale) => {
    try {
      localStorage.setItem("locale", next);
    } catch {
      /* not persisted, but the switch still applies for this session */
    }
    setLocaleState(next);
  };

  return (
    <I18nContext.Provider value={{ locale, t: dictionaries[locale], setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <div className="lang-switcher" role="group" aria-label="Language / Til">
      {(["ru", "uz"] as const).map((l) => (
        <button
          key={l}
          className={l === locale ? "active" : ""}
          onClick={() => setLocale(l)}
          aria-pressed={l === locale}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
