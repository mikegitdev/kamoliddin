import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useCampaign,
  useCampaignPlacements,
  useCampaignReviews,
  useOrders,
  usePublicPricing,
  type ApiPlacement,
} from "@/shared/api/queries";
import { ApiError } from "@/shared/api/client";
import { CampaignChip, OrderChip, PlacementChip, FallImg, QueryError } from "@/shared/ui";
import { formatDateTime, formatMinor } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { toast } from "@/shared/toast";
import { mountDialog, RefundDialogBody, confirmDialog } from "@/shared/dialog";
import { deleteCampaign, recordOutcome, requestPromotionQuote, requestRefund } from "@/features/advertiser/api";
import {
  IconAlert,
  IconArrowLeft,
  IconBag,
  IconBulb,
  IconCard,
  IconClock,
  IconExternal,
  IconGift,
  IconMoney,
  IconOrb,
  IconCheck,
  IconPencil,
  IconRocket,
  IconTrash,
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

/** Is this placement's paid promotion window live right now? (Post-hoc
 *  purchases carry explicit bounds; checkout add-ons ride the interval.) */
function promoLive(p: ApiPlacement): boolean {
  if (!p.promotion_tier) return false;
  const now = Date.now();
  if (p.promotion_started_at && new Date(p.promotion_started_at).getTime() > now) return false;
  if (p.promotion_ends_at && new Date(p.promotion_ends_at).getTime() <= now) return false;
  return true;
}

/** Joymee tariff-page equivalent: pick a tier + days for ONE running
 *  placement; the server prices it and checkout follows as a normal order. */
function PromoteDialogBody({
  t,
  locale,
  placementName,
  onSubmit,
  close,
}: {
  t: ReturnType<typeof useI18n>["t"];
  locale: "ru" | "uz";
  placementName: string;
  onSubmit: (tier: "top" | "raised", days: number) => Promise<void>;
  close: () => void;
}) {
  const { data: pricing } = usePublicPricing();
  const tariff = pricing?.tariff ?? null;
  const [tier, setTier] = useState<"top" | "raised">("top");
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);

  const tiers = (
    [
      { id: "top" as const, price: tariff?.amount_top_per_24h ?? null, label: t.promoTopName, desc: t.promoTopDesc, cls: "top" },
      { id: "raised" as const, price: tariff?.amount_raised_per_24h ?? null, label: t.promoRaisedName, desc: t.promoRaisedDesc, cls: "raised" },
    ]
  ).filter((x) => x.price != null);
  const rate = tiers.find((x) => x.id === tier)?.price ?? null;
  const total = rate != null ? rate * days : null;

  return (
    <form
      className="dialog-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || rate == null) return;
        setBusy(true);
        try {
          await onSubmit(tier, days);
          close();
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 className="dialog-title">{t.promoteDialogTitle}</h3>
      <p className="muted-2">{placementName} · {t.promoteDialogHint}</p>
      <div className="promo-options">
        {tiers.map((x) => (
          <button
            key={x.id}
            type="button"
            className={`promo-option promo-${x.cls}`}
            aria-checked={tier === x.id}
            onClick={() => setTier(x.id)}
          >
            <span className="promo-name">
              <span className={`promo-badge ${x.cls}`}>{x.id === "top" ? "TOP" : "UP"}</span>
              {x.label}
            </span>
            <span className="muted-2">{x.desc}</span>
            <span className="promo-price">
              +{formatMinor(x.price!, tariff!.currency, locale)} {t.perDayShort}
            </span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>{t.promoteDaysLabel}</span>
        <div className="row">
          <button type="button" className="btn small" onClick={() => setDays((d) => Math.max(1, d - 1))}>−</button>
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => {
              const v = Number(e.target.value);
              setDays(Number.isFinite(v) ? Math.min(30, Math.max(1, Math.round(v))) : 1);
            }}
            style={{ width: 80, textAlign: "center" }}
          />
          <button type="button" className="btn small" onClick={() => setDays((d) => Math.min(30, d + 1))}>+</button>
        </div>
      </label>
      {total != null ? (
        <p className="dialog-total">
          {t.promoteTotal}: <strong>{formatMinor(total, tariff!.currency, locale)}</strong>
        </p>
      ) : (
        <p className="muted-2">{t.estimateNoTariff}</p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={close}>{t.cancel}</button>
        <button type="submit" className="btn primary" disabled={busy || rate == null}>
          {busy ? t.loading : t.getQuoteAndPay}
        </button>
      </div>
    </form>
  );
}

/** Campaign detail in the cabinet: content, placements timeline, orders. */
export function CampaignDetailPage() {
  const { t, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: campaign, isLoading, isError, error, refetch } = useCampaign(id);
  const { data: placements } = useCampaignPlacements(id);
  const { data: orders } = useOrders();
  const { data: reviews } = useCampaignReviews(
    campaign?.review_status === "rejected" ? id : undefined,
  );
  const latestRejection = reviews?.find((r) => r.decision === "rejected");
  const lang = locale as "ru" | "uz";
  useMinuteTick();

  const removeDraft = useMutation({
    mutationFn: () => deleteCampaign(id!),
    onSuccess: () => {
      toast.success(t.draftDeleted);
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      navigate("/app/campaigns");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t.error),
  });

  const refund = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      requestRefund(orderId, reason),
    onSuccess: () => {
      toast.success(t.refundSent);
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t.error),
  });

  // Joymee tariff page: quote TOP/RAISED days for a running placement, then
  // continue through the normal one-time checkout (no wallet, ADR-0007).
  const promote = useMutation({
    mutationFn: (input: { placement_id: string; tier: "top" | "raised"; days: number }) =>
      requestPromotionQuote(input),
    onSuccess: (order) => {
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      navigate(`/app/checkout/${order.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t.error),
  });

  // Post-campaign outcome survey (Joymee borrow #8): asked once, so a race
  // or a double click just lands on the 409 the server already refuses.
  const outcome = useMutation({
    mutationFn: (answer: "brought_customers" | "other_channel" | "no_effect") =>
      recordOutcome(id!, answer),
    onSuccess: () => {
      toast.success(t.outcomeThanks);
      void queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      void queryClient.invalidateQueries({ queryKey: ["campaign", id] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t.error),
  });

  const confirmDeleteDraft = () => {
    void confirmDialog({
      t,
      title: t.deleteDraftTitle,
      body: t.deleteDraftBody,
      confirmLabel: t.deleteDraftConfirm,
      cancelLabel: t.cancel,
      danger: true,
    }).then((ok) => {
      if (ok) removeDraft.mutate();
    });
  };

  /** Cancellation of a rejected paid campaign enters the admin refund
   *  workflow (spec §7.1: correction OR cancellation options). */
  const openRefundDialog = (orderId: string) => {
    void mountDialog((close) => (
      <RefundDialogBody
        t={t}
        locale={locale}
        onSubmit={async (reason) => {
          await refund.mutateAsync({ orderId, reason });
        }}
        close={close}
      />
    ));
  };

  const openPromoteDialog = (placement: ApiPlacement) => {
    void mountDialog((close) => (
      <PromoteDialogBody
        t={t}
        locale={locale}
        placementName={placement.location_name}
        onSubmit={async (tier, days) => {
          await promote.mutateAsync({ placement_id: placement.id, tier, days });
        }}
        close={close}
      />
    ));
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
          {campaign.review_status === "draft" && (
            <button
              className="btn small danger"
              disabled={removeDraft.isPending}
              onClick={confirmDeleteDraft}
            >
              <IconTrash size={12} /> {t.deleteDraft}
            </button>
          )}
          {/* Under review: content is locked, but placements can be paid now
              and go live on approval (the editor opens on the placement step). */}
          {["submitted", "under_review"].includes(campaign.review_status) && (
            <Link className="btn primary small" to={`/app/campaigns/${campaign.id}/edit`}>
              <IconCard size={12} /> {t.buyPlacement}
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
            {campaignOrders.some((o) => o.state === "paid") && (
              <button
                className="btn small"
                onClick={() =>
                  openRefundDialog(
                    campaignOrders.find((o) => o.state === "paid")!.id,
                  )
                }
              >
                <IconMoney size={12} /> {t.cancelWithRefund}
              </button>
            )}
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

      {campaign.review_status !== "draft" && (
        <section aria-labelledby="ad-stats-heading">
          <h2 id="ad-stats-heading" className="mt-22">{t.adStatsTitle}</h2>
          <div className="info-grid">
            <div className="info-card">
              <div className="label">{t.adStatsViews}</div>
              <div className="value">{campaign.views_count}</div>
            </div>
            <div className="info-card">
              <div className="label">{t.adStatsContacts}</div>
              <div className="value">{campaign.contact_clicks_count}</div>
            </div>
          </div>
          <p className="field-hint">{t.adStatsHint}</p>
        </section>
      )}

      {/* Joymee borrow #8 — the "were you able to sell?" loop, asked once
          after the campaign fully ends. Answer feeds pricing decisions. */}
      {campaign.outcome_eligible && (
        <section className="outcome-survey" aria-labelledby="outcome-heading">
          <h2 id="outcome-heading">{t.outcomeTitle}</h2>
          <p className="muted-2">{t.outcomeHint}</p>
          <div className="row wrap gap-8 mt-10">
            {(
              [
                ["brought_customers", t.outcomeBrought],
                ["other_channel", t.outcomeOther],
                ["no_effect", t.outcomeNoEffect],
              ] as const
            ).map(([answer, label]) => (
              <button
                key={answer}
                type="button"
                className="btn"
                disabled={outcome.isPending}
                onClick={() => outcome.mutate(answer)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}
      {campaign.outcome && (
        <p className="callout">
          <IconCheck size={14} /> {t.outcomeRecorded}:{" "}
          {
            {
              brought_customers: t.outcomeBrought,
              other_channel: t.outcomeOther,
              no_effect: t.outcomeNoEffect,
            }[campaign.outcome.answer]
          }
        </p>
      )}

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
                    {p.promotion_tier && (
                      <span className={`promo-badge ${p.promotion_tier} inline ml-1`}>
                        {p.promotion_tier === "top" ? "TOP" : "UP"}
                      </span>
                    )}
                  </td>
                  <td className="muted-2" data-label={t.total}>
                    <div>{p.charge_days} × 24 {t.hoursShort}</div>
                    {promoLive(p) ? (
                      p.promotion_ends_at && (
                        <div className="promo-countdown">
                          <IconRocket size={12} /> {remainingLabel(p.promotion_ends_at, t)} {t.promoLeft}
                        </div>
                      )
                    ) : p.state === "active" ? (
                      <button
                        type="button"
                        className="btn small promo-btn"
                        onClick={() => openPromoteDialog(p)}
                      >
                        <IconRocket size={13} /> {t.promoteAction}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
