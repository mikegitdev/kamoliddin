import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LanguageSwitcher, plural, useI18n } from "@/shared/i18n";
import { useCategories, useLocationDetail, useLocationPins } from "@/shared/api/queries";
import { MapLibreAdapter, type LatLngBounds, type MapAdapter } from "@/map-adapters";
import { IconClose, IconPin, IconSearch } from "@/shared/icons";
import { ContactActions } from "@/shared/ui";

const DEFAULT_BBOX = "69.10,41.15,69.45,41.45"; // Tashkent metro area

/** Floating location card: side panel on desktop, bottom sheet on mobile. */
function LocationSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n();
  const { data: loc, isError, refetch } = useLocationDetail(id);
  const ads = loc?.active_ads ?? [];
  const directionsUrl = loc
    ? `https://2gis.uz/directions/center/${loc.lon},${loc.lat}`
    : undefined;

  return (
    <div className="loc-sheet" role="dialog" aria-label={loc?.name ?? t.details}>
      <div className="sheet-head">
        {!loc ? (
          <div className="sheet-titles">
            <div className="skeleton skeleton-line w60" />
            <div className="skeleton skeleton-line w40" />
          </div>
        ) : (
          <div className="sheet-titles">
            <strong className="sheet-business">{loc.business_name}</strong>
            <span className="muted-2">{loc.name}</span>
          </div>
        )}
        <button className="sheet-close" onClick={onClose} aria-label={t.close}>
          <IconClose />
        </button>
      </div>

      <div className="sheet-body">
        {isError ? (
          <div className="callout danger" role="alert">
            <span>{t.loadError}</span>
            <button className="btn small" onClick={() => refetch()}>
              {t.retry}
            </button>
          </div>
        ) : !loc ? (
          <>
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line w60" />
          </>
        ) : (
          <>
            <p className="sheet-address muted">{loc.address}</p>
            <ContactActions
              directionsUrl={directionsUrl}
              phone={loc.phone}
              telegram={loc.telegram}
              whatsapp={loc.whatsapp}
              site={loc.business_site}
              compact
            />
            {ads.length > 0 ? (
              <div className="sheet-ads">
                {ads.slice(0, 2).map((ad) => (
                  <Link
                    key={ad.id}
                    to={`/ads/${ad.id}`}
                    className="sheet-ad"
                    state={{ fromLocationId: loc.id }}
                  >
                    <img src={ad.banner_url} alt="" loading="lazy" />
                    <span className="sheet-ad-text">
                      <strong>{ad.headline}</strong>
                      <span className="muted-2">{ad.business_name}</span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="muted-2">{t.noAdsHere}</p>
            )}
            <div className="row">
              <Link to={`/locations/${loc.id}`} className="btn small">
                {t.details}
              </Link>
              {ads.length > 2 && (
                <Link to={`/locations/${loc.id}`} className="btn subtle small">
                  {t.viewAllAds} ({ads.length})
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function MapHomePage() {
  const { t, locale } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MapAdapter | null>(null);
  const [bbox, setBbox] = useState<string>(DEFAULT_BBOX);
  const [category, setCategory] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedPin, setSelectedPin] = useState<string | null>(null);

  const { data: categories } = useCategories();
  const { data: pins, isLoading, isError, refetch } = useLocationPins({
    bbox,
    category: category || undefined,
    q: debouncedQuery || undefined,
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!containerRef.current) return;
    const adapter = new MapLibreAdapter();
    adapter.initialize(containerRef.current);
    adapter.onViewportChange((bounds: LatLngBounds) =>
      setBbox(
        [bounds.west, bounds.south, bounds.east, bounds.north]
          .map((v) => v.toFixed(4))
          .join(","),
      ),
    );
    adapter.onMarkerClick((id) => setSelectedPin(id));
    adapterRef.current = adapter;
    return () => {
      adapter.destroy();
      adapterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!adapterRef.current || !pins) return;
    adapterRef.current.setClusters(
      pins.map((p) => ({
        id: p.id,
        lng: p.lon,
        lat: p.lat,
        activeAdsCount: p.active_ads_count,
      })),
    );
  }, [pins]);

  const totalAds = pins?.reduce((sum, p) => sum + p.active_ads_count, 0) ?? 0;
  const hasFilters = query.trim() !== "" || category !== "";
  const clearFilters = () => {
    setQuery("");
    setCategory("");
  };

  return (
    <div className="map-page">
      <div className="map-container" ref={containerRef} aria-label={t.appTitle} />

      <header className="map-header">
        <Link to="/" className="brand" aria-label={t.appTitle}>
          <span className="logo">
            <IconPin />
          </span>
          <span className="brand-text">
            {t.appTitle}
            <small>{t.tagline}</small>
          </span>
        </Link>

        <div className="controls">
          <span className="search-wrap">
            <IconSearch />
            <input
              type="search"
              placeholder={t.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t.search}
            />
          </span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label={t.allCategories}
          >
            <option value="">{t.allCategories}</option>
            {categories?.map((c) => (
              <option key={c.slug} value={c.slug}>
                {locale === "uz" ? c.name_uz : c.name_ru}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button className="btn small" onClick={clearFilters}>
              <IconClose />
              {t.clearFilters}
            </button>
          )}
        </div>

        <div className="header-utils">
          <Link className="btn primary" to="/login">
            {t.forBusiness}
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      {selectedPin && (
        <LocationSheet id={selectedPin} onClose={() => setSelectedPin(null)} />
      )}

      {!isLoading && !isError && pins?.length === 0 && (
        <div className="map-empty" role="status">
          <strong>{t.emptyTitle}</strong>
          <span className="muted">{t.emptyHint}</span>
          {hasFilters && (
            <button className="btn small" onClick={clearFilters}>
              {t.clearFilters}
            </button>
          )}
        </div>
      )}

      <footer className="map-footer">
        {isError ? (
          <span className="row" role="alert">
            <span className="error-text">{t.loadError}</span>
            <button className="btn small" onClick={() => refetch()}>
              {t.retry}
            </button>
          </span>
        ) : isLoading ? (
          <span className="muted">{t.loading}</span>
        ) : (
          <span>
            {pins?.length ?? 0} {plural(locale, "locations", pins?.length ?? 0)}
            {" · "}
            {totalAds} {plural(locale, "ads", totalAds)}
          </span>
        )}
        <span className="legend">
          <span>
            <span className="dot dot-active" /> {t.legendWithAds}
          </span>
          <span>
            <span className="dot dot-idle" /> {t.legendNoAds}
          </span>
        </span>
      </footer>
    </div>
  );
}
