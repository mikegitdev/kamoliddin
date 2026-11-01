import { Link } from "react-router-dom";
import { useI18n } from "@/shared/i18n";
import { formatDistanceM } from "@/shared/format";
import { useFeaturedAds } from "@/shared/api/queries";
import { FallImg } from "@/shared/ui";

/** Joymee VIP-pool equivalent: a compact horizontal carousel of campaigns
 *  whose TOP promotion window is live right now (GET /public/featured).
 *  Display-only — the feed's ranking is computed server-side; this strip is
 *  a separate showcase surface, like Joymee's VIP section above the list. */
export function FeaturedStrip({
  lat,
  lon,
  categoryName,
}: {
  lat: number;
  lon: number;
  /** Localized label resolver (slug → name), "" when unknown. */
  categoryName: (slug: string) => string;
}) {
  const { t, locale } = useI18n();
  const { data } = useFeaturedAds(lat, lon);
  const ads = data?.results ?? [];
  if (ads.length === 0) return null; // nothing live: the strip never shows

  return (
    <section className="featured-strip" aria-label={t.featuredTitle}>
      <div className="featured-head">
        <h2>{t.featuredTitle}</h2>
        <span className="muted-2">{t.featuredNote}</span>
      </div>
      <div className="featured-row" role="list">
        {ads.map((ad) => (
          <Link
            key={ad.id}
            to={`/ads/${ad.id}`}
            role="listitem"
            className="featured-card"
          >
            <span className="featured-media">
              <FallImg src={ad.banner_url} alt="" className="" />
              <span className="promo-badge top">TOP</span>
            </span>
            <span className="featured-body">
              <span className="featured-cat">{categoryName(ad.category)}</span>
              <strong className="featured-title">{ad.headline}</strong>
              <span className="muted-2 featured-meta">
                {ad.business_name}
                {ad.distance_m != null && (
                  <> · ≈ {formatDistanceM(ad.distance_m, locale)}</>
                )}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
