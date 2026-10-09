import { useState } from "react";
import { Link } from "react-router-dom";
import { useCampaigns } from "@/shared/api/queries";
import { CampaignChip } from "@/shared/ui";
import { formatDate } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import type { CampaignStatus } from "@/entities/types";

type Filter = "all" | "draft" | "review" | "approved" | "rejected";

const MATCHER: Record<Filter, (status: CampaignStatus) => boolean> = {
  all: () => true,
  draft: (s) => s === "draft",
  review: (s) => s === "submitted" || s === "under_review",
  approved: (s) => s === "approved" || s === "suspended",
  rejected: (s) => s === "rejected",
};

export function CampaignsPage() {
  const { t, locale } = useI18n();
  const { data: campaigns, isLoading } = useCampaigns();
  const [filter, setFilter] = useState<Filter>("all");

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: t.statusAll },
    { key: "draft", label: t.stDraft },
    { key: "review", label: t.pendingReview },
    { key: "approved", label: t.stApproved },
    { key: "rejected", label: t.stRejected },
  ];

  const visible = campaigns?.filter((c) => MATCHER[filter](c.review_status)) ?? [];

  return (
    <section>
      <div className="row-between">
        <h2>{t.campaigns}</h2>
        <Link className="btn primary" to="/app/campaigns/new">
          + {t.newCampaign}
        </Link>
      </div>

      <div className="status-filter" role="group" aria-label={t.campaigns}>
        {filters.map(({ key, label }) => (
          <button
            key={key}
            className="filter-chip"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading && (
        <>
          <div className="skeleton skeleton-card" style={{ marginTop: 14 }} />
          <div className="skeleton skeleton-card" style={{ marginTop: 10 }} />
        </>
      )}
      {campaigns && campaigns.length === 0 && (
        <p className="callout" style={{ marginTop: 14 }}>
          💡 {t.newCampaignHint}
        </p>
      )}
      {campaigns && campaigns.length > 0 && visible.length === 0 && (
        <p className="muted" style={{ marginTop: 14 }}>
          {t.emptyTitle}
        </p>
      )}
      <ul className="list">
        {visible.map((c) => (
          <li key={c.id} className="row-between">
            <div className="row" style={{ minWidth: 0 }}>
              <img className="thumb" src={c.banner_url} alt="" loading="lazy" />
              <div style={{ minWidth: 0 }}>
                <Link to={`/app/campaigns/${c.id}`} style={{ fontWeight: 700, color: "inherit" }}>
                  {c.headline}
                </Link>
                <div className="muted-2">
                  {c.business_name} · {formatDate(c.created_at, locale)}
                </div>
              </div>
            </div>
            <div className="row">
              {(c.review_status === "draft" || c.review_status === "rejected") && (
                <Link className="btn small" to={`/app/campaigns/${c.id}/edit`}>
                  ✏️ {t.editCampaign}
                </Link>
              )}
              <CampaignChip status={c.review_status} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
