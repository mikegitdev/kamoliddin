import { Link } from "react-router-dom";
import { useBusinesses, useMeSummary } from "@/shared/api/queries";
import { formatDateTime, formatMinor } from "@/shared/format";
import { useI18n } from "@/shared/i18n";

export function OverviewPage() {
  const { t, locale } = useI18n();
  const { data: summary, isLoading } = useMeSummary(true);
  const { data: businesses } = useBusinesses();
  const lang = locale as "ru" | "uz";

  return (
    <section>
      {!businesses?.length && (
        <p className="callout">
          ℹ️ {t.createBusinessHint} — <Link to="/app/business">{t.business}</Link>
        </p>
      )}

      {isLoading && <div className="skeleton skeleton-card" />}

      {summary && (
        <>
          <div className="cards">
            <div className="stat-card">
              <span className="icon">🟢</span>
              <span className="num">{summary.active_placements}</span>
              <span className="muted-2">{t.activePlacements}</span>
            </div>
            <div className="stat-card">
              <span className="icon">⏳</span>
              <span className="num">{summary.campaigns.submitted + summary.campaigns.under_review}</span>
              <span className="muted-2">{t.pendingReview}</span>
            </div>
            <div className="stat-card">
              <span className="icon">💰</span>
              <span className="num" style={{ fontSize: "1.15rem" }}>
                {formatMinor(summary.spend.total, summary.spend.currency, lang)}
              </span>
              <span className="muted-2">{t.totalSpent}</span>
            </div>
            <div className="stat-card">
              <span className="icon">📅</span>
              <span className="num" style={{ fontSize: "1.15rem" }}>
                {formatMinor(summary.spend.month, summary.spend.currency, lang)}
              </span>
              <span className="muted-2">{t.thisMonth}</span>
            </div>
          </div>

          {summary.expiring_soon.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2>⏳ {t.expiringSoon}</h2>
              <ul className="list">
                {summary.expiring_soon.map((p) => (
                  <li key={p.id} className="row-between">
                    <div>
                      <Link to={`/app/campaigns/${p.campaign_id}`}>
                        <strong>{p.headline}</strong>
                      </Link>
                      <div className="muted-2">📍 {p.location}</div>
                    </div>
                    <span className="chip orange">
                      {formatDateTime(p.ends_at, lang)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.next_renewal && (
            <div className="card" style={{ marginTop: 12 }}>
              <h2>🔁 {t.nextCharge}</h2>
              <div className="row-between">
                <div>
                  <strong>{summary.next_renewal.campaign_headline}</strong>
                  <div className="muted-2">
                    📍 {summary.next_renewal.locations_count} ·{" "}
                    {summary.next_renewal.charge_days} × 24{t.hoursShort}
                  </div>
                </div>
                <span className="chip blue">
                  {formatDateTime(summary.next_renewal.next_run_at, lang)}
                </span>
              </div>
            </div>
          )}

          <div className="quick-actions">
            <Link to="/app/campaigns/new" className="btn primary">
              + {t.newCampaign}
            </Link>
            <Link to="/app/locations" className="btn">
              + {t.addBranch}
            </Link>
            <Link to="/app/billing" className="btn">
              {t.billing}
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
