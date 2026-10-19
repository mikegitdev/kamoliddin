import { Link } from "react-router-dom";
import { useStaffPage, type ApiAdminCampaign } from "@/shared/api/queries";
import { formatDateTime } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { CampaignChip, FallImg, QueryError } from "@/shared/ui";
import type { CampaignStatus } from "@/entities/types";
import { IconBlock, IconCheck, IconExternal } from "@/shared/icons";
import {
  FilterPill,
  ServerPager,
  useDebounced,
  useHistoryState,
  usePagedOffset,
  useStaffAction,
  useStaffLink,
} from "./controls";

export function CampaignsTab({ locale }: { locale: string }) {
  const { t } = useI18n();
  const lang = locale as "ru" | "uz";
  const link = useStaffLink();
  const business = link.get("business");
  const [qInput, setQInput] = useHistoryState("campaigns.q", "");
  const q = useDebounced(qInput);
  const [status, setStatus] = useHistoryState("campaigns.status", () => link.get("status"));
  const [offset, setOffset] = usePagedOffset("campaigns.offset", [q, status, business]);
  const { data, isLoading, isError, refetch } = useStaffPage<ApiAdminCampaign>(
    "campaigns", { q, status, business }, offset,
  );
  const action = useStaffAction();

  const toggle = (c: ApiAdminCampaign) => {
    const suspending = c.review_status === "approved";
    return action.run({
      path: `campaigns/${c.id}/${suspending ? "suspend" : "unsuspend"}`,
      body: `«${c.headline}» — ${suspending ? t.confirmSuspend : t.confirmUnsuspend}`,
      confirmLabel: suspending ? t.suspend : t.unsuspend,
      danger: suspending,
    });
  };

  return (
    <section>
      <div className="row mb-14">
        <input
          placeholder={`${t.campaign} / ${t.businessesTab}…`}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          className="max-w-280"
          aria-label={t.campaign}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t.status}>
          <option value="">{t.statusAll}</option>
          <option value="approved">{t.stApproved}</option>
          <option value="suspended">{t.stSuspended}</option>
          <option value="submitted">{t.stSubmitted}</option>
          <option value="under_review">{t.stUnderReview}</option>
          <option value="rejected">{t.stRejected}</option>
          <option value="draft">{t.stDraft}</option>
        </select>
        {business && (
          <FilterPill
            label={data?.results[0]?.business_name ?? t.businessesTab}
            onClear={() => link.clear("business")}
          />
        )}
      </div>
      {isLoading && <div className="skeleton skeleton-card" />}
      {isError && <QueryError onRetry={() => refetch()} />}
      {data && (
        <p className="muted-2 mb-10">
          {t.countLabel}: {data.count}
        </p>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.campaign}</th>
              <th>{t.businessesTab}</th>
              <th>{t.status}</th>
              <th>{t.secSchedule}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.results.map((c) => (
              <tr key={c.id}>
                <td className="max-w-240 wrap-anywhere">
                  <div className="row">
                    <FallImg className="thumb" src={c.banner_url} alt="" />
                    <strong>{c.headline}</strong>
                  </div>
                </td>
                <td className="muted-2">
                  {c.business_name}
                  <div className="staff-phone">{c.owner_phone}</div>
                </td>
                <td>
                  <CampaignChip status={c.review_status as CampaignStatus} />
                  <div className="muted-2">v{c.review_version}</div>
                </td>
                <td className="muted-2">{formatDateTime(c.updated_at, lang)}</td>
                <td>
                  <div className="row">
                    <button className="btn small" onClick={() => link.go("placements", { campaign: c.id })}>
                      {t.viewPlacements}
                    </button>
                    <button
                      className="btn small"
                      onClick={() => link.go("logs", { entity: "campaign", entity_id: c.id })}
                    >
                      {t.viewLog}
                    </button>
                    <Link className="btn small" to={`/ads/${c.id}`}>
                      <IconExternal size={12} />
                    </Link>
                    {(c.review_status === "approved" || c.review_status === "suspended") && (
                      <button
                        className={`btn small${c.review_status === "approved" ? " danger" : ""}`}
                        disabled={action.busy}
                        onClick={() => void toggle(c)}
                      >
                        {c.review_status === "approved" ? <IconBlock size={12} /> : <IconCheck size={12} />}{" "}
                        {c.review_status === "approved" ? t.suspend : t.unsuspend}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <ServerPager count={data.count} offset={offset} onOffset={setOffset} />}
    </section>
  );
}
