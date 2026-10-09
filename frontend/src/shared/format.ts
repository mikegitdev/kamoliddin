import type { Locale } from "@/shared/i18n";

/** Minor units (tiyin) -> localized currency string. Integer math only
 *  (spec: money is never floating point). */
const INTL_LOCALE: Record<Locale, string> = { ru: "ru-RU", uz: "uz-UZ" };

export function formatMinor(minor: number, currency = "UZS", locale: Locale = "ru"): string {
  const major = minor / 100;
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat(INTL_LOCALE[locale], {
      maximumFractionDigits: 0,
    }).format(major);
  } catch {
    formatted = String(major);
  }
  return `${formatted} ${currency}`;
}

/** ISO string (UTC from API) -> date + time displayed in Asia/Tashkent (spec §5). */
export function formatDateTime(iso: string | null | undefined, locale: Locale = "ru"): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Tashkent",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** ISO string -> date only, Asia/Tashkent. */
export function formatDate(iso: string | null | undefined, locale: Locale = "ru"): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      dateStyle: "medium",
      timeZone: "Asia/Tashkent",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Local datetime-local value -> ISO 8601 UTC for the API (browser-local input,
 *  unchanged by the design pass — timezone conversion is a separate reviewed change). */
export function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

/** ISO string -> value usable in <input type="datetime-local">. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
