import { Link } from "react-router-dom";
import { useI18n } from "@/shared/i18n";
import type { Dict } from "@/shared/i18n/ru";
import type { ApiActiveAd, CampaignStatus, OrderState } from "@/entities/types";
import {
  IconDirections,
  IconGlobe,
  IconPhone,
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
}: {
  directionsUrl?: string;
  phone?: string | null;
  telegram?: string | null;
  whatsapp?: string | null;
  site?: string | null;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const size = compact ? "btn small" : "btn";
  const links: { href: string; label: string; icon: React.ReactNode; primary?: boolean }[] = [];

  if (directionsUrl) {
    links.push({ href: directionsUrl, label: t.directions, icon: <IconDirections />, primary: true });
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
