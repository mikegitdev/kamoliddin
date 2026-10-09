import { Link } from "react-router-dom";
import { useBusinesses, useCampaigns, useOrders } from "@/shared/api/queries";
import { useI18n } from "@/shared/i18n";

export function OverviewPage() {
  const { t } = useI18n();
  const { data: campaigns, isLoading } = useCampaigns();
  const { data: orders } = useOrders();
  const { data: businesses } = useBusinesses();

  const count = (status: string) =>
    campaigns?.filter((c) => c.review_status === status).length ?? 0;
  const paidOrders = orders?.filter((o) => o.state === "paid").length ?? 0;

  if (isLoading) {
    return (
      <section>
        <div className="cards">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      </section>
    );
  }

  // New advertiser: show the real setup path only after data has loaded.
  if (businesses && businesses.length === 0) {
    return (
      <section>
        <div className="card">
          <div className="row-between">
            <h2>{t.nextStep}</h2>
          </div>
          <div className="setup-checklist">
            <div className="check-item">
              <span className="check-num">1</span>
              <span style={{ minWidth: 0 }}>{t.setupStep1}</span>
              <Link to="/app/business" style={{ marginLeft: "auto" }}>
                {t.business} →
              </Link>
            </div>
            <div className="check-item">
              <span className="check-num">2</span>
              <span style={{ minWidth: 0 }}>{t.setupStep2}</span>
              <Link to="/app/locations" style={{ marginLeft: "auto" }}>
                {t.branches} →
              </Link>
            </div>
            <div className="check-item">
              <span className="check-num">3</span>
              <span style={{ minWidth: 0 }}>{t.setupStep3}</span>
              <Link to="/app/campaigns/new" style={{ marginLeft: "auto" }}>
                {t.newCampaign} →
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="row-between" style={{ marginBottom: 14 }}>
        <h2>{t.overview}</h2>
        <Link to="/app/campaigns/new" className="btn primary">
          + {t.newCampaign}
        </Link>
      </div>

      {/* Honest metric: "approved" is moderation state, not public visibility
          (payment and moderation are separate gates, spec §7.2). */}
      <div className="cards">
        <div className="stat-card tone-green">
          <span className="num">{count("approved")}</span>
          <span className="muted-2">{t.approvedLabel}</span>
        </div>
        <div className="stat-card tone-blue">
          <span className="num">{count("submitted") + count("under_review")}</span>
          <span className="muted-2">{t.pendingReview}</span>
        </div>
        <div className="stat-card tone-red">
          <span className="num">{count("rejected")}</span>
          <span className="muted-2">{t.rejectedLabel}</span>
        </div>
        <div className="stat-card">
          <span className="num">{count("draft")}</span>
          <span className="muted-2">{t.draftsLabel}</span>
        </div>
        <div className="stat-card tone-dark">
          <span className="num">{paidOrders}</span>
          <span className="muted-2">{t.paidOrdersLabel}</span>
        </div>
      </div>

      <div className="quick-actions">
        <Link to="/app/locations" className="btn">
          + {t.addBranch}
        </Link>
        <Link to="/app/campaigns" className="btn">
          {t.campaigns}
        </Link>
        <Link to="/app/billing" className="btn">
          {t.billing}
        </Link>
      </div>
    </section>
  );
}
