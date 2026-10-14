import { Link, useParams } from "react-router-dom";
import { useLocationDetail } from "@/shared/api/queries";
import { plural, useI18n } from "@/shared/i18n";
import { reportDialog } from "@/shared/dialog";
import { IconFlag, IconPin } from "@/shared/icons";import {
  AdCard,
  BackLink,
  ContactActions,
  HoursList,
  ShareButton,
  StickyContactActions,
  directionsUrl,
} from "@/shared/ui";

/** Public location page. One hierarchy everywhere — map sheet, this page and
 *  the ad page: business identity → offer (active ads) → address/hours →
 *  contact actions. */
export function LocationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { data: location, isLoading, isError, refetch } = useLocationDetail(id);

  if (isLoading) {
    return (
      <div className="page">
        <nav>
          <BackLink fallbackTo="/" />
        </nav>
        <div className="skeleton skeleton-hero" />
        <div className="mt-18 max-w-420">
          <div className="skeleton skeleton-line w60" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line w40" />
        </div>
      </div>
    );
  }
  if (!location) {
    return (
      <div className="page">
        <div className={isError ? "callout danger" : "callout"} role={isError ? "alert" : "status"}>
          {isError ? (
            <>
              <span>{t.loadError}</span>
              <button className="btn small" onClick={() => refetch()}>
                {t.retry}
              </button>
            </>
          ) : (
            t.notFound
          )}
        </div>
        <p className="mt-14">
          <BackLink fallbackTo="/" fallbackLabel={t.toHomepage} />
        </p>
      </div>
    );
  }

  const ads = location.active_ads;
  const dirUrl = directionsUrl(location.lon, location.lat);

  return (
    <div className="page with-sticky">
      <nav className="row-between">
        <BackLink fallbackTo="/" />
        <div className="row">
          <ShareButton title={location.business_name} />
          <button
            type="button"
            className="btn subtle small"
            aria-label={t.reportTitle}
            title={t.reportTitle}
            onClick={() => void reportDialog({ t, entity: "location", entityId: location.id })}
          >
            <IconFlag size={14} /> <span className="hide-mobile">{t.report}</span>
          </button>
        </div>
      </nav>

      {/* 1. Business identity */}
      <div className="detail-head">
        <div className="min-w-0">
          <h1>{location.business_name}</h1>
          <p className="muted">{location.name}</p>
        </div>
        {ads.length > 0 && (
          <span className="chip orange">
            {ads.length} {plural(locale, "ads", ads.length)}
          </span>
        )}
      </div>

      {/* 2. Offer: what is being advertised here right now. No dead
          heading when there is nothing to show. */}
      {ads.length > 0 ? (
        <>
          <h2>{t.activeAdsTitle}</h2>
          <div className="ad-cards">
            {ads.map((ad) => (
              <AdCard key={ad.id} ad={ad} fromLocationId={location.id} />
            ))}
          </div>
        </>
      ) : (
        <p className="muted">{t.noAdsHere}</p>
      )}

      {/* 3. Address / hours */}
      <div className="info-grid">
        <div className="info-card">
          <div className="label">{t.address}</div>
          <div className="value">{location.address}</div>
          <Link to={`/?pin=${location.id}`} className="btn small map-link">
            <IconPin size={14} /> {t.showOnMap}
          </Link>
        </div>
        <HoursList hours={location.hours} />
      </div>

      {/* 4. Contact — in-content copy hides on phones (StickyContactActions
          already pins the same actions above the safe area). */}
      <h2>{t.contacts}</h2>
      <ContactActions
        hiddenOnMobile
        directionsUrl={dirUrl}
        phone={location.phone}
        telegram={location.telegram}
        whatsapp={location.whatsapp}
        site={location.business_site}
      />

      <StickyContactActions
        directionsUrl={dirUrl}
        phone={location.phone}
        telegram={location.telegram}
        whatsapp={location.whatsapp}
        site={location.business_site}
      />
    </div>
  );
}
