import { useEffect, useState } from "react";
import { Link, useLocation as useRouterLocation, useNavigate } from "react-router-dom";
import { useI18n } from "@/shared/i18n";
import type { Dict } from "@/shared/i18n/ru";
import type { ApiActiveAd, CampaignStatus, OrderState } from "@/entities/types";
import {
  IconArrowLeft,
  IconDirections,
  IconGlobe,
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
}: ContactActionsProps) {
  const { t } = useI18n();
  const size = compact ? "btn small" : "btn";
  const links: { href: string; label: string; icon: React.ReactNode; primary?: boolean }[] = [];

  if (directionsUrl) {
    links.push({
      href: directionsUrl,
      label: shortDirections ? t.directionsShort : t.directions,
      icon: <IconDirections />,
      primary: true,
    });
  }
  if (phone) {
    links.push({ href: `tel:${phone.replace(/[^\d+]/g, "")}`, label: t.call, icon: <IconPhone /> });
  }
  const tg = telegram ? messagingUrl("telegram", telegram) : "";
  if (tg) links.push({ href: tg, label: "Telegram", icon: <IconTelegram /> });
  const wa = whatsapp ? messagingUrl("whatsapp", whatsapp) : "";
  if (wa) links.push({ href: wa, label: "WhatsApp", icon: <IconWhatsapp /> });
  if (site) links.push({ href: withProtocol(site), label: t.website, icon: <IconGlobe /> });

  if (links.length === 0) return null;
  return (
    <div className="contact-actions">
      {links.map(({ href, label, icon, primary }) => (
        <a
          key={label}
          className={primary ? `${size} primary` : size}
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

export function HoursList({ hours }: { hours: Record<string, [string, string] | undefined> }) {
  const { t } = useI18n();
  const entries = Object.entries(hours ?? {}).filter(([, v]) => Array.isArray(v));
  if (entries.length === 0) return null;
  return (
    <div className="info-card">
      <div className="label">{t.hours}</div>
      <div className="value hours-list">
        {entries.map(([day, range]) => (
          <div key={day} className="hours-row">
            <span>{day}</span>
            <span>
              {range![0]}–{range![1]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Share: URL is server-driven, so shared links keep context ---------- */

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

export function AdCard({ ad, fromLocationId }: { ad: ApiActiveAd; fromLocationId?: string }) {
  return (
    <Link to={`/ads/${ad.id}`} className="ad-card" state={{ fromLocationId }}>
      <img src={ad.banner_url} alt="" loading="lazy" />
      <div className="ad-card-body">
        <strong>{ad.headline}</strong>
        <span className="muted-2">{ad.business_name}</span>
      </div>
    </Link>
  );
}
