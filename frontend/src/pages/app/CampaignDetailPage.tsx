import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCampaign,
  useCampaignPlacements,
  useCampaignReviews,
  useOrders,
  useRenewals,
} from "@/shared/api/queries";
import { cancelRenewal, enableRenewal } from "@/features/advertiser/api";
import { ApiError } from "@/shared/api/client";
import { confirmDialog } from "@/shared/dialog";
import { toast } from "@/shared/toast";
import { CampaignChip, OrderChip, PlacementChip, FallImg, QueryError } from "@/shared/ui";
import { formatDateTime, formatMinor, formatRelative } from "@/shared/format";
import { useI18n, plural } from "@/shared/i18n";
import {
  IconAlert,
  IconArrowLeft,
  IconBag,
  IconBulb,
  IconCard,
  IconClock,
  IconExternal,
  IconGift,
  IconOrb,
  IconPencil,
  IconPin,
} from "@/shared/icons";

/** "2 дня 3 ч" / "45 мин" remaining for an active placement. */
function remainingLabel(endIso: string, t: { daysShort: string; hoursShort: string; minutesShort: string }): string {
  const ms = new Date(endIso).getTime() - Date.now();
  if (ms <= 0) return `<1 ${t.minutesShort}`;
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} ${t.daysShort}`);
  if (hours) parts.push(`${hours} ${t.hoursShort}`);
  if (!days && mins) parts.push(`${mins} ${t.minutesShort}`);
  return parts.join(" ") || `<1 ${t.minutesShort}`;
}

/** Re-render once a minute so "remaining" chips stay honest without a timer
 *  per row. */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(id);
  }, []);
}

/** Campaign detail in the cabinet: content, placements timeline, orders. */
export function CampaignDetailPage() {
  const { t, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: campaign, isLoading, isError, error, refetch } = useCampaign(id);
  const { data: placements } = useCampaignPlacements(id);
  const { data: orders } = useOrders();
  const { data: renewals } = useRenewals();
  const { data: reviews } = useCampaignReviews(
    campaign?.review_status === "rejected" ? id : undefined,
  );
  const latestRejection = reviews?.find((r) => r.decision === "rejected");
  const lang = locale as "ru" | "uz";
  const agreement = (renewals ?? []).find((r) => r.campaign === id);
  const [busy, setBusy] = useState(false);
  useMinuteTick();

  const toggleRenewal = async () => {
    if (!agreement) return;
    const cancelling = agreement.status === "active";
    const ok = await confirmDialog({
      t,
      body: cancelling ? t.confirmCancelRenewal : t.confirmEnableRenewal,
      confirmLabel: cancelling ? t.cancelRenewal : t.enableRenewal,
      cancelLabel: t.cancel,
    });
    if (!ok) return;
    setBusy(true);
    try {
      if (cancelling) {
        await cancelRenewal(agreement.id);
      } else {
        await enableRenewal(agreement.id);
      }
      qc.invalidateQueries({ queryKey: ["renewals"] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <section>
        <div className="skeleton skeleton-card" />
      </section>
    );
  }
  if (!campaign) {
    // Only a 404 means "not found"; network/server failures get a retry.
    const failed = isError && !(error instanceof ApiError && error.status === 404);
    return (
      <section>
        {failed ? (
          <QueryError onRetry={() => refetch()} />
        ) : (
          <p className="callout">{t.notFound}</p>
        )}
        <Link className="btn" to="/app/campaigns">
          <IconArrowLeft size={14} /> {t.campaigns}
        </Link>
      </section>
    );
  }

  const campaignOrders = (orders ?? []).filter((o) => o.campaign === campaign.id);
  const activePlacements = (placements ?? []).filter((p) => p.state === "active");
  // Draft/rejected edit freely; approved content is editable too (the
  // editor re-enters moderation with an explicit warning) — the affordance
  // must match the actual capability.
  const editable = ["draft", "rejected", "approved"].includes(campaign.review_status);

  return (
    <section>
      <div className="row-between mb-14">
        <Link className="btn small" to="/app/campaigns">
          <IconArrowLeft size={14} /> {t.campaigns}
        </Link>
        <div className="row">
          {campaign.review_status === "approved" && (
            <Link className="btn small" to={`/ads/${campaign.id}`}>
              <IconExternal size={12} /> {t.openAd}
            </Link>
          )}
          {editable && (
            <Link className="btn primary small" to={`/app/campaigns/${campaign.id}/edit`}>
              <IconPencil size={12} /> {t.editCampaign}
            </Link>
          )}
        </div>
      </div>

      {campaign.review_status === "rejected" && (
        <div className="rejection-card" role="alert">
          <strong><IconAlert size={14} /> {t.rejectionTitle}</strong>
          <div className="rejection-reason">
            {reviews
              ? latestRejection?.reason || t.rejectionNoReason
              : t.loading}
          </div>
          <span className="muted-2">{t.rejectionHint}</span>
          <div className="row">
            <Link className="btn primary small" to={`/app/campaigns/${campaign.id}/edit`}>
              {t.rejectionFixBtn}
            </Link>
          </div>
        </div>
      )}

      <div className="review-card">
        <FallImg className="review-banner" src={campaign.banner_url || undefined} alt="" />
        <div className="review-body">
          <div className="row-between">
            <strong className="wrap-anywhere">{campaign.headline}</strong>
            <CampaignChip status={campaign.review_status} />
          </div>
          {campaign.body && (
            <p className="muted-2 pre-wrap">{campaign.body}</p>
          )}
          <div className="muted-2">
            <IconBag size={12} /> {campaign.business_name} · {t.versionLabel} {campaign.review_version} ·{" "}
            {formatDateTime(campaign.created_at, lang)}
          </div>
          {activePlacements.length > 0 && (
            <div className="chip green"><IconOrb size={14} /> {t.activeNow}: {activePlacements.length}</div>
          )}
        </div>
      </div>

      <h2 className="mt-22">{t.whereShown}</h2>
      {placements?.length === 0 && <p className="callout"><IconBulb size={16} /> {t.noPlacements}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.branch}</th>
              <th>{t.interval}</th>
              <th>{t.status}</th>
              <th>{t.total}</th>
            </tr>
          </thead>
          <tbody>
            {placements?.map((p) => {
              const end = p.actual_end_at ?? p.end_at;
              const start = p.actual_start_at ?? p.start_at;
              return (
                <tr key={p.id}>
                  <td data-label={t.branch}>
                    <div>
                      <strong>{p.location_name}</strong>
                      <div className="muted-2">{p.location_business}</div>
                    </div>
                  </td>
                  <td className="muted-2" data-label={t.interval}>
                    <div>
                      <div>{formatDateTime(start, lang)} → {formatDateTime(end, lang)}</div>
                      {p.state === "active" && (
                        <div className="chip green mt-1">
                          <IconClock size={14} /> {remainingLabel(end, t)} {t.left}
                        </div>
                      )}
                    </div>
                  </td>
                  <td data-label={t.status}>
                    <PlacementChip state={p.state} />
                    {p.source_type === "grant" && (
                      <span className="chip orange ml-1">
                        <IconGift size={14} /> {t.grantLabel}
                      </span>
                    )}
                  </td>
                  <td className="muted-2" data-label={t.total}>
                    {p.charge_days} × 24 {t.hoursShort}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {agreement && (
        <div className="card mt-22">
          <div className="row-between">
            <div>
              <h2 className="h-icon"><IconCard size={20} /> {t.secRenewal}</h2>
              <div className="muted-2">
                <IconPin size={12} /> {agreement.locations_count}{" "}
                {plural(locale, "locations", agreement.locations_count)} · {agreement.charge_days} {t.daysShort}
              </div>
              {agreement.status === "active" && agreement.next_run_at && (
                <div className="chip blue mt-6">
                  {t.nextCharge}: {formatRelative(agreement.next_run_at, locale)}
                </div>
              )}
              {agreement.status === "alert" && (
                <div className="chip red mt-6">
                  <IconAlert size={14} /> {t.renewalAlert}
                </div>
              )}
            </div>
            <div className="stack">
              <span className={`chip ${agreement.status === "active" ? "green" : "gray"}`}>
                {agreement.status === "active" ? t.renewalActive : t.renewalDisabled}
              </span>
              <button
                className={`btn small ${agreement.status === "active" ? "" : "primary"}`}
                disabled={busy}
                onClick={toggleRenewal}
              >
                {agreement.status === "active" ? t.cancelRenewal : t.enableRenewal}
              </button>
            </div>
          </div>
        </div>
      )}

      <h2 className="mt-22">{t.ordersSection}</h2>
      {campaignOrders.length === 0 && <p className="callout"><IconBulb size={16} /> {t.noOrders}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.order}</th>
              <th>{t.total}</th>
              <th>{t.status}</th>
              <th>{t.secSchedule}</th>
            </tr>
          </thead>
          <tbody>
            {campaignOrders.map((o) => (
              <tr key={o.id}>
                <td className="muted-2" data-label={t.order}>
                  <Link to={`/app/orders/${o.id}`} title={o.id}>…{o.id.slice(0, 8)}</Link>
                </td>
                <td data-label={t.total}>{formatMinor(o.amount_total, o.currency, lang)}</td>
                <td data-label={t.status}>
                  <OrderChip state={o.state} />
                </td>
                <td className="muted-2" data-label={t.secSchedule}>
                  {formatDateTime(o.interval_start_at, lang)} →{" "}
                  {formatDateTime(o.interval_end_at, lang)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
