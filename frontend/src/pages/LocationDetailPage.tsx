import { Link, useParams } from "react-router-dom";
import { useLocationDetail } from "@/shared/api/queries";
import { plural, useI18n } from "@/shared/i18n";
import { AdCard, ContactActions } from "@/shared/ui";

function HoursList({ hours }: { hours: Record<string, [string, string] | undefined> }) {
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

export function LocationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { data: location, isLoading, isError } = useLocationDetail(id);

  if (isLoading) {
    return (
      <div className="page">
        <nav>
          <Link to="/">← {t.toHomepage}</Link>
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
          <Link className="btn" to="/">
            {t.toHomepage}
          </Link>
        </p>
      </div>
    );
  }

  const ads = location.active_ads;
  const directionsUrl = `https://2gis.uz/directions/center/${location.lon},${location.lat}`;

  return (
    <div className="page">
      <nav>
        <Link to="/">← {t.toHomepage}</Link>
      </nav>

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

      <ContactActions
        directionsUrl={directionsUrl}
        phone={location.phone}
        telegram={location.telegram}
        whatsapp={location.whatsapp}
        site={location.business_site}
      />

      <div className="info-grid">
        <div className="info-card">
          <div className="label">{t.address}</div>
          <div className="value">{location.address}</div>
        </div>
        <HoursList hours={location.hours} />
        {location.phone && (
          <div className="info-card">
            <div className="label">{t.contacts}</div>
            <div className="value">
              <a href={`tel:${location.phone.replace(/[^\d+]/g, "")}`}>{location.phone}</a>
            </div>
          </div>
        )}
      </div>

      <hr className="divider" />
      <h2>{t.activeAdsTitle}</h2>
      {ads.length === 0 && <p className="muted">{t.noAdsHere}</p>}
      <div className="ad-cards">
        {ads.map((ad) => (
          <AdCard key={ad.id} ad={ad} fromLocationId={location.id} />
        ))}
      </div>
    </div>
  );
}
