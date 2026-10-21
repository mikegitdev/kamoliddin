import { Link, useNavigate } from "react-router-dom";
import { IconArrowLeft, IconPin } from "@/shared/icons";
import { useI18n } from "@/shared/i18n";

/** Decorative city-block map: a street grid, a river, and a dashed route
 *  that wanders off and ends at a question mark. */
function LostMap() {
  return (
    <svg className="notfound-map" viewBox="0 0 320 180" aria-hidden="true" focusable="false">
      <rect width="320" height="180" rx="16" className="nf-ground" />
      <path className="nf-river" d="M-10 140 C 60 120, 90 170, 160 150 S 260 110, 330 128" />
      <g className="nf-blocks">
        <rect x="18" y="16" width="64" height="40" rx="6" />
        <rect x="96" y="16" width="44" height="40" rx="6" />
        <rect x="154" y="16" width="70" height="40" rx="6" />
        <rect x="238" y="16" width="64" height="40" rx="6" />
        <rect x="18" y="70" width="44" height="38" rx="6" />
        <rect x="76" y="70" width="64" height="38" rx="6" />
        <rect x="154" y="70" width="44" height="38" rx="6" />
        <rect x="212" y="70" width="90" height="38" rx="6" />
      </g>
      <path className="nf-route" d="M60 63 H 147 V 115 H 205 V 63 H 268" />
      <circle className="nf-start" cx="60" cy="63" r="6" />
      <g className="nf-lost" transform="translate(268 63)">
        <circle r="13" />
        <text y="5" textAnchor="middle">?</text>
      </g>
    </svg>
  );
}

export function NotFoundPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  // Deep-linked visitors have no in-app history; "back" would leave the site.
  const canGoBack = window.history.state?.idx > 0;

  return (
    <main className="page notfound-page notfound-404">
      <div className="notfound-scene">
        <LostMap />
        <p className="notfound-code" aria-hidden="true">
          4
          <span className="notfound-pin">
            <IconPin size={34} />
          </span>
          4
        </p>
      </div>
      <h1>{t.notFound}</h1>
      <p className="muted notfound-hint">{t.notFoundHint}</p>
      <div className="row justify-center mt-16 notfound-actions">
        <Link className="btn primary" to="/">
          {t.notFoundToMap}
        </Link>
        {canGoBack ? (
          <button type="button" className="btn" onClick={() => navigate(-1)}>
            <IconArrowLeft size={16} />
            {t.back}
          </button>
        ) : null}
      </div>
      <p className="notfound-business">
        <Link to="/login">{t.forBusiness} →</Link>
      </p>
    </main>
  );
}
