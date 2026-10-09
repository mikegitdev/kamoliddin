import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCampaign,
  useCampaignPlacements,
  useOrders,
  useRenewals,
} from "@/shared/api/queries";
import { cancelRenewal, enableRenewal } from "@/features/advertiser/api";
import { CampaignChip } from "@/shared/ui";
import { formatDateTime, formatMinor } from "@/shared/format";
import { useI18n } from "@/shared/i18n";

/** "2 дня 3 ч" / "45 мин" remaining for an active placement. */
function remainingLabel(endIso: string, t: { daysShort: string; hoursShort: string; minutesShort: string }): string {
  const ms = new Date(endIso).getTime() - Date.now();
  if (ms <= 0) return "0 " + t.minutesShort;
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

const PLACEMENT_STATE_CLASS: Record<string, string> = {
  active: "green",
  scheduled: "blue",
  pending: "orange",
  expired: "gray",
  cancelled: "gray",
  blocked: "red",
};

/** Campaign detail in the cabinet: content, placements timeline, orders. */
export function CampaignDetailPage() {
  const { t, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: campaign, isLoading } = useCampaign(id);
  const { data: placements } = useCampaignPlacements(id);
  const { data: orders } = useOrders();
  const { data: renewals } = useRenewals();
  const lang = locale as "ru" | "uz";
  const agreement = (renewals ?? []).find((r) => r.campaign === id);
  const [busy, setBusy] = useState(false);

  const toggleRenewal = async () => {
    if (!agreement) return;
    setBusy(true);
    try {
      if (agreement.status === "active") {
        await cancelRenewal(agreement.id);
      } else {
        await enableRenewal(agreement.id);
      }
      qc.invalidateQueries({ queryKey: ["renewals"] });
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
    return (
      <section>
        <p className="callout">{t.notFound}</p>
        <Link className="btn" to="/app/campaigns">
          ← {t.campaigns}
        </Link>
      </section>
    );
  }

  const campaignOrders = (orders ?? []).filter((o) => o.campaign === campaign.id);
  const activePlacements = (placements ?? []).filter((p) => p.state === "active");
  const editable = campaign.review_status === "draft" || campaign.review_status === "rejected";

  return (
    <section>
      <div className="row-between" style={{ marginBottom: 14 }}>
        <Link className="btn small" to="/app/campaigns">
          ← {t.campaigns}
        </Link>
        <div className="row">
          {campaign.review_status === "approved" && (
            <Link className="btn small" to={`/ads/${campaign.id}`}>
              🔗 {t.openAd}
            </Link>
          )}
          {editable && (
            <Link className="btn primary small" to={`/app/campaigns/${campaign.id}/edit`}>
              ✏️ {t.editCampaign}
            </Link>
          )}
        </div>
      </div>

      <div className="review-card">
        <img className="review-banner" src={campaign.banner_url} alt="" />
        <div className="review-body">
          <div className="row-between">
            <strong style={{ overflowWrap: "anywhere" }}>{campaign.headline}</strong>
            <CampaignChip status={campaign.review_status} />
          </div>
          {campaign.body && (
            <p className="muted-2" style={{ whiteSpace: "pre-wrap" }}>
              {campaign.body}
            </p>
          )}
          <div className="muted-2">
            🏪 {campaign.business_name} · v{campaign.review_version} ·{" "}
            {formatDateTime(campaign.created_at, lang)}
          </div>
          {activePlacements.length > 0 && (
            <div className="chip green">🟢 {t.activeNow}: {activePlacements.length}</div>
          )}
        </div>
      </div>

      <h2 style={{ marginTop: 22 }}>{t.whereShown}</h2>
      {placements?.length === 0 && <p className="callout">💡 {t.noPlacements}</p>}
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
                  <td>
                    <strong>{p.location_name}</strong>
                    <div className="muted-2">{p.location_business}</div>
                  </td>
                  <td className="muted-2">
                    {formatDateTime(start, lang)} → {formatDateTime(end, lang)}
                    {p.state === "active" && (
                      <div className="chip green" style={{ marginTop: 4 }}>
                        ⏳ {remainingLabel(end, t)} {t.left}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`chip ${PLACEMENT_STATE_CLASS[p.state] ?? "gray"}`}>
                      {p.state}
                    </span>
                    {p.source_type === "grant" && (
                      <span className="chip orange" style={{ marginLeft: 4 }}>
                        🎁 {t.grantLabel}
                      </span>
                    )}
                  </td>
                  <td className="muted-2">
                    {p.charge_days} × 24{t.hoursShort}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {agreement && (
        <div className="card" style={{ marginTop: 22 }}>
          <div className="row-between">
            <div>
              <h2>🔁 {t.secRenewal}</h2>
              <div className="muted-2">
                📍 {agreement.locations_count} · {agreement.charge_days} × 24{t.hoursShort}
              </div>
              {agreement.status === "active" && agreement.next_run_at && (
                <div className="chip blue" style={{ marginTop: 6 }}>
                  {t.nextCharge}: {formatDateTime(agreement.next_run_at, lang)}
                </div>
              )}
              {agreement.status === "alert" && (
                <div className="chip red" style={{ marginTop: 6 }}>
                  ⚠️ {t.renewalAlert}
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

      <h2 style={{ marginTop: 22 }}>{t.ordersSection}</h2>
      {campaignOrders.length === 0 && <p className="callout">💡 {t.noOrders}</p>}
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
                <td className="muted-2">…{o.id.slice(0, 8)}</td>
                <td>{formatMinor(o.amount_total, o.currency, lang)}</td>
                <td>
                  <span className="chip gray">{o.state}</span>
                </td>
                <td className="muted-2">
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
