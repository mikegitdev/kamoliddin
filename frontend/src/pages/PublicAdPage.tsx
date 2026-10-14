import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, ApiError } from "@/shared/api/client";
import { IconFlag, IconLock, IconPin } from "@/shared/icons";
import { reportDialog } from "@/shared/dialog";
import type { ApiCampaignDetail } from "@/entities/types";
import { plural, useI18n } from "@/shared/i18n";
import { formatDate } from "@/shared/format";
import {
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

  return (
    <div className={`page${featured ? " with-sticky" : ""}`}>
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

      <div className="ad-banner">
        <FallImg src={data.banner_url} alt={data.headline} />
      </div>
      {/* Ad disclosure: visitors must always see this is paid placement. */}
      <p className="ad-eyebrow">{t.adLabel}</p>
      <h1>{data.headline}</h1>
      <p className="muted ad-validity">
        {data.business_name}
        {data.ends_at &&
          ` · ${t.validUntil} ${formatDate(data.ends_at, locale)}`}
      </p>
      <p className="ad-body">{data.body}</p>

      {featured && (
        <section className="branch-section" aria-labelledby="branch-heading">
          <h2 id="branch-heading">{t.offerLocations}</h2>
          <div className="card branch-card">
            <div className="branch-head">
              <strong>{featured.name}</strong>
              {locations.length > 1 && (
                <span className="chip orange">
                  {locations.length} {plural(locale, "locations", locations.length)}
                </span>
              )}
            </div>
            <div className="info-grid">
              <div className="info-card">
                <div className="label">{t.address}</div>
                <div className="value">{featured.address}</div>
                <Link to={`/?pin=${featured.id}`} className="btn small map-link">
                  <IconPin size={14} /> {t.showOnMap}
                </Link>
              </div>
              <HoursList hours={featured.hours} />
            </div>
            <ContactActions
              hiddenOnMobile
              directionsUrl={featuredDirections}
              phone={featured.phone}
              telegram={featured.telegram}
              whatsapp={featured.whatsapp}
              site={featured.business_site}
            />
            <div className="row">
              <Link to={`/locations/${featured.id}`} className="btn subtle small">
                {t.toBranch}
              </Link>
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
        </section>
      )}

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
