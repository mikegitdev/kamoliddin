import { useParams } from "react-router-dom";
import { useLocationDetail } from "@/shared/api/queries";
import { plural, useI18n } from "@/shared/i18n";
import {
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
  const { data: location, isLoading, isError } = useLocationDetail(id);

  if (isLoading) {
    return (
      <div className="page">
        <nav>
          <BackLink fallbackTo="/" />
        </nav>
        <div className="skeleton" style={{ height: 200, borderRadius: 18 }} />
        <div style={{ marginTop: 18, maxWidth: 420 }}>
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
        <div className="callout" role="status">
          {isError ? t.loadError : t.notFound}
        </div>
        <p style={{ marginTop: 14 }}>
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
        <ShareButton title={location.business_name} />
      </nav>

      {/* 1. Business identity */}
      <div className="detail-head">
        <div style={{ minWidth: 0 }}>
          <h1>{location.business_name}</h1>
          <p className="muted">{location.name}</p>
        </div>
        {ads.length > 0 && (
          <span className="chip orange">
            {ads.length} {plural(locale, "ads", ads.length)}
          </span>
        )}
      </div>

      {/* 2. Offer: what is being advertised here right now */}
      <h2>{t.activeAdsTitle}</h2>
      {ads.length === 0 && <p className="muted">{t.noAdsHere}</p>}
      <div className="ad-cards">
        {ads.map((ad) => (
          <AdCard key={ad.id} ad={ad} fromLocationId={location.id} />
        ))}
      </div>

      {/* 3. Address / hours */}
      <div className="info-grid">
        <div className="info-card">
          <div className="label">{t.address}</div>
          <div className="value">{location.address}</div>
        </div>
        <HoursList hours={location.hours} />
      </div>

      {/* 4. Contact */}
      <h2>{t.contacts}</h2>
      <ContactActions
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
