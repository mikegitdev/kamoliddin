import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, ApiError } from "@/shared/api/client";
import { useCategories, useLocationDetail } from "@/shared/api/queries";
import { MiniMap } from "@/shared/mini-map";
import { IconArrowRight, IconClock, IconFlag, IconLock, IconPin } from "@/shared/icons";
import { reportDialog } from "@/shared/dialog";
import type { ApiCampaignDetail } from "@/entities/types";
import { plural, useI18n } from "@/shared/i18n";
import { formatDate } from "@/shared/format";
import {
  AdCard,
  BackLink,
  ContactActions,
  FallImg,
  HoursList,
  ShareButton,
  StickyContactActions,
  directionsUrl,
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
  const fromLocationId = (routerLocation.state as { fromLocationId?: string } | null)
    ?.fromLocationId;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["public-ad", id],
    queryFn: () => api<ApiCampaignDetail>(`/api/v1/public/campaigns/${id}`),
    retry: false,
    enabled: !!id,
  });
  // Featured branch detail: category name, live pin count and the branch's
  // other offers. Same cache entry as the location page.
  const featuredId =
    data?.locations?.find((l) => l.id === fromLocationId)?.id ?? data?.locations?.[0]?.id;
  const { data: featuredDetail } = useLocationDetail(featuredId);
  const { data: categories } = useCategories();

  if (isLoading) {
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
    const unavailable = isError && error instanceof ApiError && error.status === 404;
    return (
      <div className="page">
        <div className={unavailable ? "callout" : "callout danger"} role={unavailable ? "status" : "alert"}>
          <span>{unavailable ? (<><IconLock size={14} /> {t.adUnavailable}</>) : t.loadError}</span>
          {!unavailable && (
            <button className="btn small" onClick={() => refetch()}>
              {t.retry}
            </button>
          )}
        </div>
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
  const daysLeft = data.ends_at ? daysUntil(data.ends_at) : null;
  const categoryName = categories?.find((c) => c.slug === featuredDetail?.category);
  const moreOffers = (featuredDetail?.active_ads ?? []).filter((ad) => ad.id !== data.id);

  return (
    <div className={`page ad-page${featured ? " with-sticky" : ""}`}>
      <nav className="row-between">
        <BackLink fallbackTo="/" />
        <div className="row">
          <ShareButton title={data.headline} />
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
              {categoryName && (
                <span className="muted-2">{locale === "uz" ? categoryName.name_uz : categoryName.name_ru}</span>
              )}
            </div>
          </div>

          {/* 2. Offer. Ad disclosure: visitors must always see this is paid placement. */}
          <div className="ad-meta">
            <span className="chip gray">{t.adLabel}</span>
            {daysLeft !== null && daysLeft > 0 && (
              <span className="chip ad-countdown">
                <IconClock size={13} />
                {daysLeft === 1
                  ? t.endsToday
                  : `${t.endsIn} ${daysLeft} ${plural(locale, "days", daysLeft)}`}
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

/** Whole days until `iso`, rounded up: 1 = ends within the next 24h. */
function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}
