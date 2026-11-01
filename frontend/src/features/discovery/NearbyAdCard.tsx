import { Link } from "react-router-dom";
import { plural, useI18n } from "@/shared/i18n";
import { formatDistanceM } from "@/shared/format";
import type { ApiNearbyAd } from "@/shared/api/queries";
import { IconPin, IconRocket } from "@/shared/icons";
import { FallImg, VerifiedBadge } from "@/shared/ui";

/** Joymee-style paid visibility badge: TOP (crown tier) or UP (raised tier).
 *  Purely presentational — the server already ordered the feed so promoted
 *  cards lead; the badge just explains WHY a farther card is first. */
export function PromoBadge({ tier, title }: { tier: "top" | "raised" | null; title: string }) {
  if (!tier) return null;
  return (
    <span className={`promo-badge ${tier}`} title={title}>
      <IconRocket size={11} />
      {tier === "top" ? "TOP" : "UP"}
    </span>
  );
}

/** One ad card of the nearby list: banner → offer → business → branch + distance.
 *  The primary action opens the existing public ad page; "on map" hands the
 *  visitor to the map with this branch selected. No nested interactive
 *  elements — media and headline are the card's links, actions sit in their
 *  own row. */
export function NearbyAdCard({
  ad,
  index,
  categoryName,
  onShowOnMap,
}: {
  ad: ApiNearbyAd;
  /** Position in the list; drives the capped staggered entrance. */
  index: number;
  /** Localized category label (slug → name), "" when unknown. */
  categoryName: string;
  onShowOnMap: (ad: ApiNearbyAd) => void;
}) {
  const { t, locale } = useI18n();
  const state = { fromLocationId: ad.location.id };
  return (
    <li style={{ "--i": Math.min(index, 8) } as React.CSSProperties}>
      <article className="nearby-ad-card">
        <Link to={`/ads/${ad.id}`} className="nac-media" state={state} tabIndex={-1} aria-hidden="true">
          <FallImg src={ad.banner_url} alt="" className="" />
          {ad.promotion && <PromoBadge tier={ad.promotion} title={t.promoBadgeTitle} />}
        </Link>
        <div className="nac-body">
          <div className="nac-top">
            {categoryName && <span className="nac-category">{categoryName}</span>}
            {ad.distance_m != null && (
              <span className="nac-distance" title={t.distanceNote}>
                ≈ {formatDistanceM(ad.distance_m, locale)}
              </span>
            )}
          </div>
          <h3 className="nac-headline">
            <Link to={`/ads/${ad.id}`} state={state}>
              {ad.headline}
            </Link>
          </h3>
          <p className="nac-business">
            {ad.business_name}
            {ad.business_verified && <VerifiedBadge title={t.verifiedTitle} />}
          </p>
          {ad.body.trim() !== "" && <p className="nac-text">{ad.body}</p>}
          <p className="nac-branch">
            {ad.location.name}
            {ad.branches_count > 1 && (
              <span className="muted-2">
                {" · "}
                {t.alsoInBranches} {ad.branches_count - 1}{" "}
                {plural(locale, "branches", ad.branches_count - 1)}
              </span>
            )}
          </p>
          <div className="nac-actions">
            <Link className="btn small primary" to={`/ads/${ad.id}`} state={state}>
              {t.openAd}
            </Link>
            <button
              type="button"
              className="btn small"
              onClick={() => onShowOnMap(ad)}
            >
              <IconPin size={16} />
              {t.showOnMap}
            </button>
          </div>
        </div>
      </article>
    </li>
  );
}
