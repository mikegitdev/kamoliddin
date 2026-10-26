import type { Locale } from "@/shared/i18n";

/** E.164 (+998901234567) -> display form (+998 90 123 45 67).
 *  Non-Uzbek numbers fall back to the raw value rather than a wrong mask. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const m = e164.match(/^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/);
  if (!m) return e164;
  return `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
}

/** Minor units (tiyin) -> localized currency string. Integer math only
 *  (spec: money is never floating point). */
const INTL_LOCALE: Record<Locale, string> = { ru: "ru-RU", uz: "uz-UZ" };

/* Chrome ships no Uzbek ICU data: Intl with "uz-UZ" falls back to raw forms
 * ("2026 M10 15", "tomorrow", "Mon", "46,260,000"). Numbers borrow ru-RU
 * grouping (same space separator); dates, weekdays and relative time are
 * spelled out by hand below. */
const NUMBER_LOCALE: Record<Locale, string> = { ru: "ru-RU", uz: "ru-RU" };
const UZ_MONTHS = ["yan", "fev", "mar", "apr", "may", "iyun", "iyul", "avg", "sen", "okt", "noy", "dek"];
const UZ_WEEKDAYS: Record<string, string> = {
  mon: "Du", tue: "Se", wed: "Ch", thu: "Pa", fri: "Ju", sat: "Sh", sun: "Ya",
};

/** Date parts in Asia/Tashkent, independent of locale data. */
function tashkentParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: get("year"), month: Number(get("month")), day: Number(get("day")),
    time: `${get("hour").replace("24", "00")}:${get("minute")}`,
  };
}

function uzDate(d: Date, withTime: boolean): string {
  const p = tashkentParts(d);
  const date = `${p.day}-${UZ_MONTHS[p.month - 1]}, ${p.year}`;
  return withTime ? `${date}, ${p.time}` : date;
}

const UZ_UNITS = { minute: "daqiqa", hour: "soat", day: "kun" } as const;
function uzRelative(value: number, unit: keyof typeof UZ_UNITS): string {
  if (unit === "day" && value === 1) return "ertaga";
  if (unit === "day" && value === -1) return "kecha";
  if (unit === "day" && value === 0) return "bugun";
  if (unit === "minute" && value === 0) return "hozir";
  const n = Math.abs(value);
  return value > 0 ? `${n} ${UZ_UNITS[unit]}dan keyin` : `${n} ${UZ_UNITS[unit]} oldin`;
}

export function formatMinor(minor: number, currency = "UZS", locale: Locale = "ru"): string {
  const major = minor / 100;
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat(NUMBER_LOCALE[locale], {
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
    if (locale === "uz") return uzDate(new Date(iso), true);
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
    if (locale === "uz") return uzDate(new Date(iso), false);
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      dateStyle: "medium",
      timeZone: "Asia/Tashkent",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/* datetime-local inputs hold Tashkent wall time (spec §5), whatever the
 * device's own timezone — the same clock every date in the UI is shown in.
 * Asia/Tashkent is UTC+5 all year (no DST since 1992): a fixed offset. */
const TASHKENT_OFFSET = "+05:00";

/** datetime-local value (Tashkent wall time) -> epoch ms; NaN if invalid. */
export function tashkentInputMs(value: string): number {
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  return new Date(`${withSeconds}${TASHKENT_OFFSET}`).getTime();
}

/** datetime-local value (Tashkent wall time) -> ISO 8601 UTC for the API;
 *  "" for an empty/invalid value. */
export function localInputToIso(value: string): string {
  const ms = tashkentInputMs(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

/** Date -> datetime-local value in Tashkent wall time. */
export function toTashkentInput(d: Date): string {
  const p = tashkentParts(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${p.time}`;
}

/** Relative time like "через 2 дня" / "5 мин назад" (auto unit).
 *  Falls back to the absolute date for anything beyond a week. */
export function formatRelative(iso: string | null | undefined, locale: Locale = "ru"): string {
  if (!iso) return "—";
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return iso;
  const diffMs = target - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(INTL_LOCALE[locale], { numeric: "auto" });
  const fmt = (value: number, unit: "minute" | "hour" | "day") =>
    locale === "uz" ? uzRelative(value, unit) : rtf.format(value, unit);
  const min = 60_000;
  if (abs < 10 * min) return fmt(Math.round(diffMs / min), "minute");
  if (abs < 3_600_000 * 12) return fmt(Math.round(diffMs / 3_600_000), "hour");
  if (abs < 86_400_000 * 7) {
    // Calendar days in Tashkent, so 23:57 tonight reads "today", not "tomorrow".
    const a = tashkentParts(new Date());
    const b = tashkentParts(new Date(target));
    const days = Math.round(
      (Date.UTC(+b.year, b.month - 1, b.day) - Date.UTC(+a.year, a.month - 1, a.day)) / 86_400_000,
    );
    return fmt(days, "day");
  }
  return formatDateTime(iso, locale);
}

/** Meters -> "850 м" / "2,4 км" (search result cards). */
/** Compact remaining time for live countdowns: "3 д 14 ч" / "3 kun 14 soat",
 *  switching to a ticking "HH:MM:SS" clock in the final 24h. Clamps at 0. */
export function formatCountdown(msLeft: number, locale: Locale): string {
  const totalSec = Math.max(0, Math.floor(msLeft / 1000));
  const days = Math.floor(totalSec / 86_400);
  if (days > 0) {
    const hours = Math.floor((totalSec % 86_400) / 3_600);
    return locale === "uz" ? `${days} kun ${hours} soat` : `${days} д ${hours} ч`;
  }
  const hours = Math.floor(totalSec / 3_600);
  const minutes = Math.floor((totalSec % 3_600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(totalSec % 60)}`;
}

export function formatDistanceM(meters: number, locale: Locale = "ru"): string {
  const nf = new Intl.NumberFormat(NUMBER_LOCALE[locale], { maximumFractionDigits: 1 });
  if (meters < 1000) return `${nf.format(Math.max(1, Math.round(meters)))} м`;
  return `${nf.format(meters / 1000)} км`;
}

/** Compact travel duration from minutes: "7 мин", "1 ч 20 мин"
 *  (uz keeps full words: "7 daqiqa", "1 soat 20 daqiqa"). */
export function formatTravelMin(minutes: number, locale: Locale = "ru"): string {
  const total = Math.max(1, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (locale === "uz") {
    return h === 0 ? `${m} daqiqa` : m === 0 ? `${h} soat` : `${h} soat ${m} daqiqa`;
  }
  return h === 0 ? `${m} мин` : m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

/** Bytes -> "1,2 МБ" / "1.2 MB" — locale-aware unit labels, one implementation
 *  shared by the banner editor and the campaign editor. */
const BYTE_UNITS: Record<Locale, { kb: string; mb: string }> = {
  ru: { kb: "КБ", mb: "МБ" },
  uz: { kb: "KB", mb: "MB" },
};
export function formatBytes(bytes: number, locale: Locale = "ru"): string {
  const nf = new Intl.NumberFormat(NUMBER_LOCALE[locale], { maximumFractionDigits: 1 });
  if (bytes >= 1024 * 1024) return `${nf.format(bytes / (1024 * 1024))} ${BYTE_UNITS[locale].mb}`;
  return `${nf.format(Math.max(1, Math.round(bytes / 1024)))} ${BYTE_UNITS[locale].kb}`;
}

/** Whole 24h units billed for an interval (mirrors billing.models.compute_charge_days):
 *  a 25h request bills 2 days. Used only for the editor's live estimate —
 *  the quote endpoint stays the source of truth. */
export function estimateChargeDays(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max(1, Math.ceil((end - start) / 86_400_000));
}

/* ---------- Opening hours (Tashkent timezone) ---------- */

export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

const JS_DAY_TO_KEY: Record<number, WeekDay> = {
  0: "sun", 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat",
};

/** Localized weekday abbreviation (Пн / Dush). */
export function weekdayLabel(day: WeekDay, locale: Locale): string {
  if (locale === "uz") return UZ_WEEKDAYS[day];
  // Fixed dates whose weekday is known: 2024-01-01 is a Monday.
  const dates: Record<WeekDay, string> = {
    mon: "2024-01-01", tue: "2024-01-02", wed: "2024-01-03", thu: "2024-01-04",
    fri: "2024-01-05", sat: "2024-01-06", sun: "2024-01-07",
  };
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: "short" })
    .format(new Date(dates[day] + "T12:00:00Z"))
    .replace(".", "");
}

/** Current weekday key + HH:MM in Asia/Tashkent. */
export function tashkentNow(): { day: WeekDay; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday").slice(0, 3).toLowerCase();
  const key = (WEEK_DAYS as readonly string[]).includes(weekday)
    ? (weekday as WeekDay)
    : JS_DAY_TO_KEY[new Date().getDay()];
  return { day: key, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** "09:00" -> 540 minutes. */
function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Open-now check for a hours map (mon..sun -> [open, close] | undefined).
 *  Handles ranges crossing midnight (22:00–02:00). */
export function isOpenNow(
  hours: Record<string, [string, string] | undefined>,
  now = tashkentNow(),
): boolean {
  const today = hours[now.day];
  if (today) {
    const open = hhmmToMinutes(today[0]);
    const close = hhmmToMinutes(today[1]);
    if (close > open) return now.minutes >= open && now.minutes < close;
    return now.minutes >= open || now.minutes < close; // overnight
  }
  // Maybe we are inside yesterday's overnight range.
  const idx = WEEK_DAYS.indexOf(now.day);
  const yesterday = WEEK_DAYS[(idx + 6) % 7];
  const prev = hours[yesterday];
  if (prev && hhmmToMinutes(prev[1]) < hhmmToMinutes(prev[0])) {
    return now.minutes < hhmmToMinutes(prev[1]);
  }
  return false;
}
