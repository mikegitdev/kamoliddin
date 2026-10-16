import { useEffect, useState } from "react";
import { Link, useLocation as useRouterLocation, useNavigate } from "react-router-dom";
import { useI18n } from "@/shared/i18n";
import type { Dict } from "@/shared/i18n/ru";
import { isOpenNow, tashkentNow, WEEK_DAYS, weekdayLabel, type WeekDay } from "@/shared/format";
import type { ApiActiveAd, CampaignStatus, OrderState } from "@/entities/types";
import {
  IconArrowLeft,
  IconCopy,
  IconDirections,
  IconGlobe,
  IconMegaphone,
  IconPhone,
  IconShare,
  IconTelegram,
  IconWhatsapp,
} from "@/shared/icons";

/* ---------- Status chips: localized labels, API enums unchanged ---------- */

const CAMPAIGN_CLASS: Record<CampaignStatus, string> = {
  draft: "chip gray",
  submitted: "chip blue",
  under_review: "chip blue",
  approved: "chip green",
  rejected: "chip red",
  suspended: "chip dark",
};

const CAMPAIGN_LABEL: Record<CampaignStatus, keyof Dict> = {
  draft: "stDraft",
  submitted: "stSubmitted",
  under_review: "stUnderReview",
  approved: "stApproved",
  rejected: "stRejected",
  suspended: "stSuspended",
};

const ORDER_CLASS: Record<OrderState, string> = {
  draft_quote: "chip gray",
  awaiting_payment: "chip blue",
  payment_processing: "chip blue",
  paid: "chip green",
  failed: "chip red",
  expired: "chip dark",
};

const ORDER_LABEL: Record<OrderState, keyof Dict> = {
  draft_quote: "stQuote",
  awaiting_payment: "stAwaiting",
  payment_processing: "stProcessing",
  paid: "stPaid",
  failed: "stFailed",
  expired: "stExpired",
};

export function CampaignChip({ status }: { status: CampaignStatus }) {
  const { t } = useI18n();
  return <span className={CAMPAIGN_CLASS[status] ?? "chip gray"}>{t[CAMPAIGN_LABEL[status]]}</span>;
}

export function OrderChip({ state }: { state: OrderState }) {
  const { t } = useI18n();
  return <span className={ORDER_CLASS[state] ?? "chip gray"}>{t[ORDER_LABEL[state]]}</span>;
}

/* ---------- Placement / attempt / refund / report chips ----------
   Every API enum the UI surfaces gets a localized label — no raw snake_case
   ever reaches the user. */

const PLACEMENT_CLASS: Record<string, string> = {
  pending: "chip gray",
  scheduled: "chip blue",
  active: "chip green",
  expired: "chip gray",
  cancelled: "chip gray",
  blocked: "chip red",
};
const PLACEMENT_LABEL: Record<string, keyof Dict> = {
  pending: "stPlacementPending",
  scheduled: "stPlacementScheduled",
  active: "stPlacementActive",
  expired: "stPlacementExpired",
  cancelled: "stPlacementCancelled",
  blocked: "stPlacementBlocked",
};

export function PlacementChip({ state }: { state: string }) {
  const { t } = useI18n();
  const label = PLACEMENT_LABEL[state];
  return (
    <span className={PLACEMENT_CLASS[state] ?? "chip gray"}>
      {label ? t[label] : state}
    </span>
  );
}

const ATTEMPT_CLASS: Record<string, string> = {
  succeeded: "chip green",
  pending: "chip orange",
  failed: "chip red",
};
const ATTEMPT_LABEL: Record<string, keyof Dict> = {
  succeeded: "stAttemptSucceeded",
  pending: "stAttemptPending",
  failed: "stAttemptFailed",
};

export function AttemptChip({ status }: { status: string }) {
  const { t } = useI18n();
  const label = ATTEMPT_LABEL[status];
  return (
    <span className={ATTEMPT_CLASS[status] ?? "chip gray"}>
      {label ? t[label] : status}
    </span>
  );
}

const REFUND_CLASS: Record<string, string> = {
  requested: "chip orange",
  admin_review: "chip blue",
  refunded: "chip green",
  rejected: "chip red",
};
const REFUND_LABEL: Record<string, keyof Dict> = {
  requested: "stRefundRequested",
  admin_review: "stRefundAdminReview",
  refunded: "stRefundRefunded",
  rejected: "stRefundRejected",
};

export function RefundStateChip({ state }: { state: string }) {
  const { t } = useI18n();
  const label = REFUND_LABEL[state];
  return (
    <span className={REFUND_CLASS[state] ?? "chip gray"}>
      {label ? t[label] : state}
    </span>
  );
}

const REPORT_CLASS: Record<string, string> = {
  open: "chip orange",
  resolved: "chip green",
  dismissed: "chip gray",
};
const REPORT_LABEL: Record<string, keyof Dict> = {
  open: "stReportOpen",
  resolved: "stReportResolved",
  dismissed: "stReportDismissed",
};

export function ReportStateChip({ state }: { state: string }) {
  const { t } = useI18n();
  const label = REPORT_LABEL[state];
  return (
    <span className={REPORT_CLASS[state] ?? "chip gray"}>
      {label ? t[label] : state}
    </span>
  );
}

/* ---------- Contact actions: shared by map sheet and location page ---------- */

/** Directions deep link to the branch coordinates (2GIS directions API,
 *  the map provider used across the public UI). */
export function directionsUrl(lon: number, lat: number): string {
  return `https://2gis.uz/directions/center/${lon},${lat}`;
}

export interface ContactActionsProps {
  directionsUrl?: string;
  phone?: string | null;
  telegram?: string | null;
  whatsapp?: string | null;
  site?: string | null;
  compact?: boolean;
  /** Compact label for the directions action ("Маршрут"), used where the
   *  full "Проложить маршрут" does not fit — e.g. the mobile sticky bar. */
  shortDirections?: boolean;
  /** Hide on phones: pages with a StickyContactActions bar render the same
   *  actions twice on small screens — the in-content copy goes away. */
  hiddenOnMobile?: boolean;
}
function withProtocol(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function messagingUrl(kind: "telegram" | "whatsapp", value: string): string {
  const v = value.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (kind === "telegram") return `https://t.me/${v.replace(/^@/, "")}`;
  const digits = v.replace(/\D/g, "");
  if (digits.length >= 9) return `https://wa.me/${digits}`;
  return "";
}

export function ContactActions({
  directionsUrl,
  phone,
  telegram,
  whatsapp,
  site,
  compact = false,
  shortDirections = false,
  hiddenOnMobile = false,
}: ContactActionsProps) {
  const { t } = useI18n();
  const size = compact ? "btn small" : "btn";
  // Joymee pairing: brand-filled route + solid black call; the rest stay quiet.
  const links: { href: string; label: string; icon: React.ReactNode; tone?: "primary" | "dark" }[] = [];

  if (directionsUrl) {
    links.push({
      href: directionsUrl,
      label: shortDirections ? t.directionsShort : t.directions,
      icon: <IconDirections />,
      tone: "primary",
    });
  }
  if (phone) {
    links.push({
      href: `tel:${phone.replace(/[^\d+]/g, "")}`,
      label: t.call,
      icon: <IconPhone />,
      tone: "dark",
    });
  }
  const tg = telegram ? messagingUrl("telegram", telegram) : "";
  if (tg) links.push({ href: tg, label: "Telegram", icon: <IconTelegram /> });
  const wa = whatsapp ? messagingUrl("whatsapp", whatsapp) : "";
  if (wa) links.push({ href: wa, label: "WhatsApp", icon: <IconWhatsapp /> });
  if (site) links.push({ href: withProtocol(site), label: t.website, icon: <IconGlobe /> });

  if (links.length === 0) return null;
  return (
    <div className={hiddenOnMobile ? "contact-actions hide-mobile" : "contact-actions"}>
      {links.map(({ href, label, icon, tone }) => (
        <a
          key={label}
          className={tone ? `${size} ${tone}` : size}
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          {icon} {label}
        </a>
      ))}
    </div>
  );
}

/** Same actions pinned above the safe area on phones (hidden on desktop), so
 *  directions/call/messaging stay reachable anywhere on the page. */
export function StickyContactActions(props: Omit<ContactActionsProps, "compact" | "shortDirections">) {
  return (
    <div className="sticky-actions">
      <ContactActions {...props} compact shortDirections />
    </div>
  );
}

/* ---------- Opening hours: shared by location page and ad branch card ---------- */

/** Hours with localized day names, today highlighted, and an open-now badge
 *  (Asia/Tashkent). Raw API keys (mon..sun) never reach the user. */
export function HoursList({ hours }: { hours: Record<string, [string, string] | undefined> }) {
  const { t, locale } = useI18n();
  const entries = WEEK_DAYS.map((day) => ({ day, range: hours?.[day] })).filter(
    (e): e is { day: WeekDay; range: [string, string] } => Array.isArray(e.range),
  );
  if (entries.length === 0) return null;
  const now = tashkentNow();
  const open = isOpenNow(hours ?? {});
  return (
    <div className="info-card">
      <div className="label hours-label">
        <span>{t.hours}</span>
        <span className={`chip ${open ? "green" : "gray"}`}>
          {open ? t.hoursOpenNow : t.hoursClosedNow}
        </span>
      </div>
      <div className="value hours-list">
        {entries.map(({ day, range }) => (
          <div key={day} className={`hours-row${day === now.day ? " today" : ""}`}>
            <span>{day === now.day ? t.todayLabel : weekdayLabel(day, locale)}</span>
            <span>
              {range[0]}–{range[1]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Share: URL is server-driven, so shared links keep context ---------- */

/** Copy an opaque ID (order, campaign) to the clipboard with feedback —
 *  truncated UUIDs are unreadable; at least make the full value portable
 *  for support conversations. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      /* insecure context: keep the value selectable nearby instead */
    }
  };

  return (
    <button type="button" className="btn subtle small" onClick={copy} title={value}>
      <IconCopy /> {copied ? t.idCopied : (label ?? t.copyLabel)}
    </button>
  );
}

export function ShareButton({ title }: { title?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const onShare = async () => {
    const url = window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: title ?? document.title, url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return; // dismissed
        // other failures (e.g. no share handler): fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* clipboard unavailable (insecure context): silently keep the URL visible */
    }
  };

  return (
    <button type="button" className="btn subtle small" onClick={onShare}>
      <IconShare /> {copied ? t.linkCopied : t.share}
    </button>
  );
}

/** Failed-load callout with retry — a query error must never render as an
 *  empty list or "not found". */
export function QueryError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="callout danger" role="alert">
      <span>{t.loadError}</span>
      <button className="btn small" onClick={onRetry}>
        {t.retry}
      </button>
    </div>
  );
}

/* ---------- Back: return to the previous results, share-safe ---------- */

/** In-app history exists ("location.key !== 'default'") when the visitor
 *  navigated here from the map/list; a direct/shared link opens with the
 *  default key, so we fall back to an explicit destination instead of a
 *  dead history.back(). */
export function BackLink({ fallbackTo, fallbackLabel }: { fallbackTo: string; fallbackLabel?: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { key } = useRouterLocation();

  if (key === "default") {
    return (
      <Link to={fallbackTo}>
        <IconArrowLeft size={14} /> {fallbackLabel ?? t.toHomepage}
      </Link>
    );
  }
  return (
    <button type="button" className="link-button" onClick={() => navigate(-1)}>
      <IconArrowLeft size={14} /> {t.back}
    </button>
  );
}

/* ---------- Ad card: one banner + headline + business, shared everywhere ---------- */

/** Image with a styled fallback: a broken/missing banner must not leave a
 *  blank hole or a browser broken-image glyph (design review 0.10). */
export function FallImg({
  src,
  alt,
  className,
}: {
  src: string | undefined;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <div className={`${className ?? ""} img-fallback`.trim()} aria-hidden="true">
        <IconMegaphone size={22} />
      </div>
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** `hideBusiness`: on pages that are already about one business, the name
 *  on every card is noise. */
export function AdCard({
  ad,
  fromLocationId,
  hideBusiness = false,
}: {
  ad: ApiActiveAd;
  fromLocationId?: string;
  hideBusiness?: boolean;
}) {
  return (
    <Link to={`/ads/${ad.id}`} className="ad-card" state={{ fromLocationId }}>
      <FallImg src={ad.banner_url} alt="" className="" />
      <div className="ad-card-body">
        <strong>{ad.headline}</strong>
        {!hideBusiness && <span className="muted-2">{ad.business_name}</span>}
      </div>
    </Link>
  );
}
