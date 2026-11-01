/** Public "ads near you" list view (spec §10): distance-ordered ad cards fed
 *  by /api/v1/public/ads. Shares search/category with the map (state lives in
 *  MapHomePage); owns only presentation: radius chips, sort, load-more,
 *  empty/error states, and the origin controls (geolocation / pick on map). */
import { useI18n, plural } from "@/shared/i18n";
import {
  NEARBY_RADIUS_OPTIONS,
  useNearbyAds,
  type ApiNearbyAd,
} from "@/shared/api/queries";
import type { ApiCategory } from "@/entities/types";
import { IconDirections, IconPin } from "@/shared/icons";
import { FeaturedStrip } from "./FeaturedStrip";
import { NearbyAdCard } from "./NearbyAdCard";

/** The exact query object shape returned by useNearbyAds(). */
type NearbyAdsQuery = ReturnType<typeof useNearbyAds>;
type GeoState = "idle" | "locating" | "denied";

export function NearbyAdsList({
  query,
  originLabel,
  originKind,
  geoState,
  categories,
  locale,
  searchActive,
  sort,
  onSortChange,
  radius,
  onRadiusChange,
  onUseMyLocation,
  onPickOnMap,
  onShowOnMap,
  hasFilters,
  onClearFilters,
  originLat,
  originLon,
}: {
  query: NearbyAdsQuery;
  /** Human label of the distance origin ("Near you" / picked point / city center). */
  originLabel: string;
  originKind: "user" | "manual" | "default";
  geoState: GeoState;
  categories: ApiCategory[];
  locale: "ru" | "uz";
  /** True when a text query is active (sort control only makes sense then). */
  searchActive: boolean;
  /** Effective sort; null hides the control (no query → always nearest). */
  sort: "distance" | "relevance" | null;
  onSortChange: (s: "distance" | "relevance") => void;
  radius: number;
  onRadiusChange: (m: number) => void;
  onUseMyLocation: () => void;
  onPickOnMap: () => void;
  onShowOnMap: (ad: ApiNearbyAd) => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  /** Distance origin for the featured strip (same point the feed sorts by). */
  originLat: number;
  originLon: number;
}) {
  const { t } = useI18n();
  const pages = query.data?.pages ?? [];
  const ads = pages.flatMap((p) => p.results);
  const hasMore = pages.length > 0 && pages[pages.length - 1].has_more;

  const categoryNames = new Map(categories.map((c) => [c.slug, locale === "uz" ? c.name_uz : c.name_ru]));
  const categoryName = (slug: string) => categoryNames.get(slug) ?? "";

  return (
    <section className="ads-page" aria-label={t.adsListTitle}>
      <div className="ads-wrap">
        <header className="ads-head">
          <div className="ads-head-text">
            <h1>{t.adsListTitle}</h1>
            <p className="muted">
              {originLabel} · {t.distanceNote}
            </p>
          </div>
          <div className="ads-origin">
            <button
              type="button"
              className="btn small"
              onClick={onUseMyLocation}
              disabled={geoState === "locating"}
            >
              <IconDirections size={16} />
              {geoState === "locating" ? t.geoLocating : t.useMyLocation}
            </button>
            <button type="button" className="btn small" onClick={onPickOnMap}>
              <IconPin size={16} />
              {t.pickAreaOnMap}
            </button>
          </div>
        </header>

        {geoState === "denied" && originKind !== "user" && (
          <p className="ads-geo-hint muted" role="status">
            {t.geoDeniedHint}
          </p>
        )}

        <div className="ads-controls">
          <div className="radius-chips" role="group" aria-label={t.radiusLabel}>
            {NEARBY_RADIUS_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                className={m === radius ? "radius-chip active" : "radius-chip"}
                aria-pressed={m === radius}
                onClick={() => onRadiusChange(m)}
              >
                {m >= 1000 ? `${m / 1000} км` : `${m} м`}
              </button>
            ))}
          </div>
          {searchActive && sort && (
            <div className="radius-chips sort-chips" role="group" aria-label={t.sortLabel}>
              <button
                type="button"
                className={sort === "relevance" ? "radius-chip active" : "radius-chip"}
                aria-pressed={sort === "relevance"}
                onClick={() => onSortChange("relevance")}
              >
                {t.sortBest}
              </button>
              <button
                type="button"
                className={sort === "distance" ? "radius-chip active" : "radius-chip"}
                aria-pressed={sort === "distance"}
                onClick={() => onSortChange("distance")}
              >
                {t.sortNearest}
              </button>
            </div>
          )}
          {ads.length > 0 && (
            <span className="ads-count muted" aria-live="polite">
              {t.adsShown}: {ads.length} {plural(locale, "ads", ads.length)}
            </span>
          )}
        </div>

        {query.isError && pages.length === 0 ? (
          <div className="callout danger" role="alert">
            <span>{t.loadError}</span>
            <button className="btn small" onClick={() => query.refetch()}>
              {t.retry}
            </button>
          </div>
        ) : query.isLoading && pages.length === 0 ? (
          <ul className="ads-list" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <li key={i}>
                <div className="nearby-ad-card skeleton-card">
                  <div className="skeleton nac-skel-media" />
                  <div className="nac-body">
                    <div className="skeleton skeleton-line w40" />
                    <div className="skeleton skeleton-line" />
                    <div className="skeleton skeleton-line w60" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : ads.length === 0 ? (
          <div className="ads-empty" role="status">
            <strong>{t.noAdsNearbyTitle}</strong>
            <span className="muted">{t.noAdsNearbyHint}</span>
            <div className="row">
              {radius < NEARBY_RADIUS_OPTIONS[NEARBY_RADIUS_OPTIONS.length - 1] && (
                <button
                  className="btn small"
                  onClick={() =>
                    onRadiusChange(
                      NEARBY_RADIUS_OPTIONS[NEARBY_RADIUS_OPTIONS.length - 1],
                    )
                  }
                >
                  {t.expandRadius}
                </button>
              )}
              <button className="btn small" onClick={onPickOnMap}>
                {t.pickAreaOnMap}
              </button>
              {hasFilters && (
                <button className="btn subtle small" onClick={onClearFilters}>
                  {t.clearFilters}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Joymee's VIP carousel: live TOP promotions showcase above the
                organic results — hidden automatically when nothing is live. */}
            <FeaturedStrip lat={originLat} lon={originLon} categoryName={categoryName} />
            <ul className="ads-list">
              {ads.map((ad, i) => (
                <NearbyAdCard
                  key={`${ad.id}@${ad.location.id}`}
                  ad={ad}
                  index={i}
                  categoryName={categoryName(ad.category)}
                  onShowOnMap={onShowOnMap}
                />
              ))}
            </ul>
            {query.isError && pages.length > 0 && (
              <div className="callout danger" role="alert">
                <span>{t.loadError}</span>
                <button className="btn small" onClick={() => query.refetch()}>
                  {t.retry}
                </button>
              </div>
            )}
            <div className="ads-more">
              {hasMore ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? t.loading : t.loadMore}
                </button>
              ) : (
                <span className="muted-2">{t.adsShown}: {ads.length}</span>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
