import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCampaigns } from "@/shared/api/queries";
import { CampaignChip, FallImg, QueryError } from "@/shared/ui";
import { formatDate } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { toast } from "@/shared/toast";
import { confirmDialog } from "@/shared/dialog";
import { deleteCampaign } from "@/features/advertiser/api";
import { ApiError } from "@/shared/api/client";
import { IconBulb, IconPencil, IconTrash } from "@/shared/icons";
import type { CampaignStatus } from "@/entities/types";

type Filter = "all" | "draft" | "review" | "approved" | "suspended" | "rejected";

const MATCHER: Record<Filter, (status: CampaignStatus) => boolean> = {
  all: () => true,
  draft: (s) => s === "draft",
  review: (s) => s === "submitted" || s === "under_review",
  approved: (s) => s === "approved",
  suspended: (s) => s === "suspended",
  rejected: (s) => s === "rejected",
};

/** Initial page size + step for the client-side "show more" — the API has no
 *  pagination yet, but lists must not become an endless wall. */
const PAGE_SIZE = 10;

export function CampaignsPage() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const { data: campaigns, isLoading, isError, refetch } = useCampaigns();
  const [filter, setFilter] = useState<Filter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const removeDraft = useMutation({
    mutationFn: (id: string) => deleteCampaign(id),
    onSuccess: () => {
      toast.success(t.draftDeleted);
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : t.error);
    },
  });

  /** Delete is drafts-only (backend-enforced): nothing was submitted, paid
   *  or reviewed — no moderation or financial record to preserve (spec §7.1). */
  const confirmDeleteDraft = (id: string) => {
    void confirmDialog({
      t,
      title: t.deleteDraftTitle,
      body: t.deleteDraftBody,
      confirmLabel: t.deleteDraftConfirm,
      cancelLabel: t.cancel,
      danger: true,
    }).then((ok) => {
      if (ok) removeDraft.mutate(id);
    });
  };

  const countFor = (key: Filter) =>
    (campaigns ?? []).filter((c) => MATCHER[key](c.review_status)).length;

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: t.statusAll },
    { key: "draft", label: t.stDraft },
    { key: "review", label: t.pendingReview },
    { key: "approved", label: t.stApproved },
    { key: "suspended", label: t.stSuspended },
    { key: "rejected", label: t.stRejected },
  ];

  const visible = (campaigns ?? [])
    .filter((c) => MATCHER[filter](c.review_status))
    .slice(0, visibleCount);

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
            onClick={() => {
              setFilter(key);
              setVisibleCount(PAGE_SIZE);
            }}
          >
            {label} <span className="filter-count">{countFor(key)}</span>
          </button>
        ))}
      </div>

      {isLoading && (
        <>
          <div className="skeleton skeleton-card mt-14" />
          <div className="skeleton skeleton-card mt-10" />
        </>
      )}
      {isError && !campaigns && (
        <div className="mt-14">
          <QueryError onRetry={() => refetch()} />
        </div>
      )}
      {campaigns && campaigns.length === 0 && (
        <p className="callout mt-14">
          <IconBulb size={16} /> {t.newCampaignHint}
        </p>
      )}
      {campaigns && campaigns.length > 0 && visible.length === 0 && (
        <p className="muted mt-14">{t.emptyTitle}</p>
      )}
      <ul className="campaign-list">
        {visible.map((c) => (
          <li key={c.id} className="campaign-card">
            <Link to={`/app/campaigns/${c.id}`} className="cc-click" aria-label={c.headline}>
              <FallImg className="thumb" src={c.banner_url || undefined} alt="" />
              <div className="cc-main">
                <span className="cc-title">{c.headline}</span>
                <span className="muted-2">
                  {c.business_name}
                  {c.next_interval && (
                    <>
                      {" · "}
                      {t.secSchedule}: {formatDate(c.next_interval.start_at, locale)} →{" "}
                      {formatDate(c.next_interval.end_at, locale)}
                    </>
                  )}
                  {" · "}
                  {formatDate(c.created_at, locale)}
                </span>
              </div>
            </Link>
            <div className="cc-side">
              {/* Publication state — deliberately separate from the
                  moderation chip above it: approved ≠ live (spec §7). */}
              {c.active_placements_count > 0 && (
                <span className="chip green">
                  {t.showingNow}: {c.active_placements_count}
                </span>
              )}
              <CampaignChip status={c.review_status} />
              {(c.review_status === "draft" || c.review_status === "rejected") && (
                <Link className="btn small" to={`/app/campaigns/${c.id}/edit`}>
                  <IconPencil size={12} /> {c.review_status === "rejected" ? t.rejectionFixBtn : t.continueDraft}
                </Link>
              )}
              {c.review_status === "draft" && (
                <button
                  className="btn small danger"
                  disabled={removeDraft.isPending && removeDraft.variables === c.id}
                  aria-label={t.deleteDraft}
                  title={t.deleteDraft}
                  onClick={() => confirmDeleteDraft(c.id)}
                >
                  <IconTrash size={12} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {campaigns && countFor(filter) > visible.length && (
        <p className="cc-more-row">
          <button className="btn subtle small" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
            {t.showMore} ({countFor(filter) - visible.length})
          </button>
        </p>
      )}
    </section>
  );
}
