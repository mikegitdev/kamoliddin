import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/shared/api/client";
import { useCategories, useLocationDetail } from "@/shared/api/queries";
import { MiniMap } from "@/shared/mini-map";
import { IconArrowRight, IconClock, IconFlag, IconLock, IconPin } from "@/shared/icons";
import { reportDialog } from "@/shared/dialog";
import type { AdVisibility, ApiCampaignDetail, ApiCampaignPreview } from "@/entities/types";
import type { Dict } from "@/shared/i18n/ru";
import { plural, useI18n, type Locale } from "@/shared/i18n";
import { formatDate, formatCountdown } from "@/shared/format";
import { useNow } from "@/shared/hooks";
import {
  AdCard,
  BackLink,
  ContactActions,
  FallImg,
  HoursList,
  ShareButton,
  StickyContactActions,
  directionsUrl,
  shareHoursLine,
  shareText,
  truncate,
} from "@/shared/ui";

/** Active-only ad details; expired/unapproved returns 404 (spec §14).
 *
 *  Branch context comes from the API (`locations` = branches where this ad is
 *  currently eligible), so a shared link opened directly — without any client
 *  navigation state — still shows address, hours, directions and contacts.
 *  The `fromLocationId` carried by in-app navigation only picks WHICH branch
 *  is featured, and only after the API confirms the ad is eligible there. */
export function PublicAdPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const routerLocation = useLocation();
  const [searchParams] = useSearchParams();
  // In-app navigation passes state; a shared link carries ?loc= instead.
  const fromLocationId =
    (routerLocation.state as { fromLocationId?: string } | null)?.fromLocationId ??
    searchParams.get("loc") ??
    undefined;

  const { data: live, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["public-ad", id],
    queryFn: () => api<ApiCampaignDetail>(`/api/v1/public/campaigns/${id}`),
    retry: false,
    enabled: !!id,
  });
  const unavailable = isError && error instanceof ApiError && error.status === 404;
  // Not live (scheduled, in review, suspended, ended…): staff still get the
  // page from the staff-only preview, flagged as not public. Everyone else
  // gets 401/403 there and sees the "not shown right now" message.
  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ["ad-preview", id],
    queryFn: () => api<ApiCampaignPreview>(`/api/v1/admin/campaigns/${id}/preview`),
    retry: false,
    enabled: !!id && unavailable,
  });
  const data: ApiCampaignDetail | ApiCampaignPreview | undefined = unavailable ? preview : (live ?? preview);
  // Featured branch detail: category name, live pin count and the branch's
  // other offers. Same cache entry as the location page.
  const featuredId =
    data?.locations?.find((l) => l.id === fromLocationId)?.id ?? data?.locations?.[0]?.id;
  const { data: featuredDetail } = useLocationDetail(featuredId);
  const { data: categories } = useCategories();

  // Live expiry countdown: ticks every second once under 24h remain so the
  // clock visibly counts down; every 30s before that (chip shows days+hours).
  const endsMs = data?.ends_at ? new Date(data.ends_at).getTime() : null;
  const now = useNow(endsMs !== null && endsMs - Date.now() > 86_400_000 ? 30_000 : 1_000);
  // Offer ended while the page was open: refetch once so the public endpoint
  // 404s and the page falls through to the "not shown right now" state (spec §14).
  const expired = live && endsMs !== null && endsMs - now <= 0;
  const expiryFetched = useRef(false);
  useEffect(() => {
    if (expired && !expiryFetched.current) {
      expiryFetched.current = true;
      void refetch();
    }
  }, [expired, refetch]);

  if (isLoading || (unavailable && previewLoading)) {
    return (
      <div className="page">
        <nav>
          <BackLink fallbackTo="/" />
        </nav>
        <div className="skeleton skeleton-hero tall" />
        <div className="mt-18 max-w-420">
          <div className="skeleton skeleton-line w60" />
          <div className="skeleton skeleton-line" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        {unavailable ? (
          <div className="callout" role="status">
            <strong>
              <IconLock size={14} /> {t.adUnavailable}
            </strong>
            <span>{t.adUnavailableHint}</span>
          </div>
        ) : (
          <div className="callout danger" role="alert">
            <span>{t.loadError}</span>
            <button className="btn small" onClick={() => refetch()}>
              {t.retry}
            </button>
          </div>
        )}
        <p className="mt-14">
          <Link className="btn" to="/">
            {t.toHomepage}
          </Link>
        </p>
      </div>
    );
  }

  // Identity → offer → address/hours → contact, same as the location page.
  const locations = data.locations ?? [];
  const featured = locations.find((l) => l.id === fromLocationId) ?? locations[0];
  const others = locations.filter((l) => l.id !== featured?.id);
  const featuredDirections = featured ? directionsUrl(featured.lon, featured.lat) : undefined;
  const msLeft = endsMs !== null ? endsMs - now : null;
  const categoryName = categories?.find((c) => c.slug === featuredDetail?.category);
  const moreOffers = (featuredDetail?.active_ads ?? []).filter((ad) => ad.id !== data.id);
  const categoryLabel = categoryName ? (locale === "uz" ? categoryName.name_uz : categoryName.name_ru) : "";

  // Share: offer first, then where/when/how to reach it — readable without opening the link.
  const shareUrl = new URL(`/ads/${data.id}`, window.location.origin);
  if (featured && locations.length > 1) shareUrl.searchParams.set("loc", featured.id);
  const shareBody = shareText([
    `📣 ${data.headline}`,
    `🏢 ${data.business_name}${categoryLabel ? ` · ${categoryLabel}` : ""}`,
    data.body && truncate(data.body, 200),
    data.ends_at && `⏳ ${t.validUntil} ${formatDate(data.ends_at, locale)}`,
    featured && `📍 ${featured.name}, ${featured.address}`,
    others.length > 0 && `➕ ${t.otherBranches}: ${others.length}`,
    featured && shareHoursLine(featured.hours, t),
    featured?.phone && `📞 ${featured.phone}`,
  ]);

  return (
    <div className={`page ad-page${featured ? " with-sticky" : ""}`}>
      <nav className="row-between">
        <BackLink fallbackTo="/" />
        <div className="row">
          <ShareButton title={data.headline} text={shareBody} url={shareUrl.toString()} />
          <button
            type="button"
            className="btn subtle small"
            aria-label={t.reportTitle}
            title={t.reportTitle}
            onClick={() => void reportDialog({ t, entity: "campaign", entityId: data.id })}
          >
            <IconFlag size={14} /> <span className="hide-mobile">{t.report}</span>
          </button>
        </div>
      </nav>

      {preview && preview.visibility !== "live" && (
        <div className="callout mb-14" role="status">
          <strong>
            <IconLock size={14} /> {t.adPreviewTitle}
          </strong>
          <span>
            {visibilityText(preview, t, locale)}
          </span>
          <Link className="btn small" to={`/staff?tab=placements&campaign=${preview.id}`}>
            {t.viewPlacements}
          </Link>
        </div>
      )}

      <div className="ad-layout">
        <article className="ad-main">
          <div className="ad-banner ad-hero">
            <FallImg src={data.banner_url} alt={data.headline} />
          </div>

          {/* 1. Business identity */}
          <div className="ad-business">
            <span className="ad-business-tile" aria-hidden="true">
              {data.business_name.trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <strong>{data.business_name}</strong>
              {categoryLabel && <span className="muted-2">{categoryLabel}</span>}
            </div>
          </div>

          {/* 2. Offer. Ad disclosure: visitors must always see this is paid placement. */}
          <div className="ad-meta">
            <span className="chip gray">{t.adLabel}</span>
            {msLeft !== null && msLeft > 0 && (
              <span className="chip ad-countdown">
                <IconClock size={13} />
                {t.endsIn} {formatCountdown(msLeft, locale)}
              </span>
            )}
            {data.ends_at && (
              <span className="muted-2">
                {t.validUntil} {formatDate(data.ends_at, locale)}
              </span>
            )}
          </div>
          <h1 className="ad-title">{data.headline}</h1>
          <p className="ad-body">{data.body}</p>
        </article>

        {/* 3. Address / hours / contact for the featured branch */}
        {featured && (
          <aside className="ad-aside" aria-labelledby="branch-heading">
            <div className="ad-aside-head">
              <h2 id="branch-heading">{t.offerLocations}</h2>
              {locations.length > 1 && (
                <span className="chip gray">
                  {locations.length} {plural(locale, "locations", locations.length)}
                </span>
              )}
            </div>
            <div className="card ad-panel">
              {featuredDetail && (
                <MiniMap
                  id={featured.id}
                  lon={featured.lon}
                  lat={featured.lat}
                  label={featured.name}
                  activeAdsCount={featuredDetail.active_ads.length}
                />
              )}
              <div className="ad-panel-body">
                <Link to={`/locations/${featured.id}`} className="ad-panel-name">
                  <strong>{featured.name}</strong>
                  <IconArrowRight size={16} />
                </Link>
                <p className="ad-panel-address">
                  <IconPin size={15} />
                  <span>{featured.address}</span>
                </p>
                <HoursList hours={featured.hours} />
                <ContactActions
                  hiddenOnMobile
                  shortDirections
                  directionsUrl={featuredDirections}
                  phone={featured.phone}
                  telegram={featured.telegram}
                  whatsapp={featured.whatsapp}
                  site={featured.business_site}
                />
              </div>
            </div>

            {others.length > 0 && (
              <div className="branch-others">
                <strong className="muted">
                  {t.otherBranches} ({others.length})
                </strong>
                <ul>
                  {others.map((loc) => (
                    <li key={loc.id}>
                      <Link to={`/locations/${loc.id}`}>
                        <strong>{loc.name}</strong>
                        <span className="muted-2">{loc.address}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        )}

        {/* 4. Keep browsing: other live offers at the same branch */}
        {featured && moreOffers.length > 0 && (
          <section className="ad-more" aria-labelledby="more-heading">
            <h2 id="more-heading">{t.moreOffersHere}</h2>
            <div className="ad-cards">
              {moreOffers.map((ad) => (
                <AdCard key={ad.id} ad={ad} fromLocationId={featured.id} hideBusiness />
              ))}
            </div>
          </section>
        )}
      </div>

      {featured && (
        <StickyContactActions
          directionsUrl={featuredDirections}
          phone={featured.phone}
          telegram={featured.telegram}
          whatsapp={featured.whatsapp}
          site={featured.business_site}
        />
      )}
    </div>
  );
}

const VISIBILITY_TEXT: Record<Exclude<AdVisibility, "live">, keyof Dict> = {
  draft: "visDraft",
  submitted: "visSubmitted",
  under_review: "visUnderReview",
  rejected: "visRejected",
  suspended: "visSuspended",
  business_disabled: "visBusinessDisabled",
  location_disabled: "visLocationDisabled",
  blocked: "visBlocked",
  pending: "visPending",
  scheduled: "visScheduled",
  ended: "visEnded",
  no_placements: "visNoPlacements",
};

/** Staff-facing reason the ad is not public, with the date when it explains it. */
function visibilityText(p: ApiCampaignPreview, t: Dict, locale: Locale): string {
  if (p.visibility === "live") return "";
  const text = t[VISIBILITY_TEXT[p.visibility]];
  if (p.visibility === "scheduled" && p.starts_at) return `${text} ${formatDate(p.starts_at, locale)}`;
  if (p.visibility === "ended" && p.ends_at) return `${text} — ${formatDate(p.ends_at, locale)}`;
  return text;
}
