import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  useStaffPage,
  type ApiAdminBusiness,
  type ApiAdminLocation,
} from "@/shared/api/queries";
import { formatPhone } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { IconBlock, IconCheck, IconExternal } from "@/shared/icons";
import { QueryError } from "@/shared/ui";
import {
  FilterPill,
  ServerPager,
  StatusChip,
  SubTabs,
  useDebounced,
  useHistoryState,
  usePagedOffset,
  useStaffAction,
  useStaffLink,
} from "./controls";

type View = "businesses" | "branches";

export function BusinessesTab({ locale }: { locale: string }) {
  const { t } = useI18n();
  const link = useStaffLink();
  // A business drill-down (?business=) opens the branches view directly.
  const businessFilter = link.get("business");
  const [view, setView] = useHistoryState<View>("businesses.view", () =>
    businessFilter || link.get("view") === "branches" ? "branches" : "businesses",
  );
  useEffect(() => {
    if (businessFilter) setView("branches");
  }, [businessFilter, setView]);

  return (
    <section>
      <SubTabs<View>
        value={view}
        onChange={setView}
        options={[
          ["businesses", t.businessesTab],
          ["branches", t.viewBranches],
        ]}
      />
      {view === "businesses" ? (
        <BusinessList locale={locale} />
      ) : (
        <BranchList businessFilter={businessFilter} />
      )}
    </section>
  );
}

function BusinessList({ locale }: { locale: string }) {
  const { t } = useI18n();
  const link = useStaffLink();
  const owner = link.get("owner");
  const [qInput, setQInput] = useHistoryState("businesses.q", "");
  const q = useDebounced(qInput);
  const [status, setStatus] = useHistoryState("businesses.status", () => link.get("status"));
  const [offset, setOffset] = usePagedOffset("businesses.offset", [q, status, owner]);
  const { data, isLoading, isError, refetch } = useStaffPage<ApiAdminBusiness>(
    "businesses", { q, status, owner }, offset,
  );
  const action = useStaffAction();

  const toggle = (b: ApiAdminBusiness) => {
    const disabling = b.status === "active";
    return action.run({
      path: `businesses/${b.id}/status`,
      payload: { status: disabling ? "disabled" : "active" },
      body: `«${b.name}» — ${disabling ? t.confirmDisableBusiness : t.confirmEnableBusiness}`,
      confirmLabel: disabling ? t.disable : t.enable,
      danger: disabling,
    });
  };

  return (
    <>
      <div className="row mb-14">
        <input
          placeholder={`${t.businessesTab} / ${t.phone}…`}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          className="max-w-280"
          aria-label={t.businessesTab}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t.status}>
          <option value="">{t.statusAll}</option>
          <option value="active">{t.stActive}</option>
          <option value="disabled">{t.stDisabled}</option>
          <option value="under_review">{t.stUnderReviewShort}</option>
        </select>
        {owner && (
          <FilterPill
            label={data?.results[0] ? formatPhone(data.results[0].owner_phone) : t.owner}
            onClear={() => link.clear("owner")}
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
              <th>{t.businessesTab}</th>
              <th>{t.owner}</th>
              <th>{t.status}</th>
              <th>{t.branchesCount}</th>
              <th>{t.campaignsCount}</th>
              <th>{t.liveAds}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.results.map((b) => (
              <tr key={b.id}>
                <td className="max-w-240 wrap-anywhere">
                  <strong>{b.name}</strong>
                  <div className="muted-2">{locale === "uz" ? b.category_uz : b.category_ru}</div>
                </td>
                <td className="muted-2">
                  <button className="link-button" onClick={() => link.go("users", { user: b.owner_id })}>
                    <span className="staff-phone">{formatPhone(b.owner_phone)}</span>
                  </button>
                  {!b.owner_active && (
                    <div>
                      <StatusChip status="blocked" />
                    </div>
                  )}
                </td>
                <td>
                  <StatusChip status={b.status} />
                </td>
                <td>{b.locations_count}</td>
                <td>{b.campaigns_count}</td>
                <td>{b.live_ads}</td>
                <td>
                  <div className="row">
                    <button className="btn small" onClick={() => link.go("businesses", { business: b.id })}>
                      {t.viewBranches}
                    </button>
                    <button className="btn small" onClick={() => link.go("placements", { business: b.id })}>
                      {t.viewPlacements}
                    </button>
                    <button
                      className="btn small"
                      onClick={() => link.go("logs", { entity: "business", entity_id: b.id })}
                    >
                      {t.viewLog}
                    </button>
                    {b.status !== "under_review" && (
                      <button
                        className={`btn small${b.status === "active" ? " danger" : ""}`}
                        disabled={action.busy}
                        onClick={() => void toggle(b)}
                      >
                        {b.status === "active" ? <IconBlock size={12} /> : <IconCheck size={12} />}{" "}
                        {b.status === "active" ? t.disable : t.enable}
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
    </>
  );
}

function BranchList({ businessFilter }: { businessFilter: string }) {
  const { t } = useI18n();
  const link = useStaffLink();
  const [qInput, setQInput] = useHistoryState("branches.q", "");
  const q = useDebounced(qInput);
  const [status, setStatus] = useHistoryState("branches.status", () => link.get("status"));
  const [offset, setOffset] = usePagedOffset("branches.offset", [q, status, businessFilter]);
  const { data, isLoading, isError, refetch } = useStaffPage<ApiAdminLocation>(
    "locations", { q, status, business: businessFilter }, offset,
  );
  const action = useStaffAction();

  const toggle = (l: ApiAdminLocation) => {
    const disabling = l.status === "active";
    return action.run({
      path: `locations/${l.id}/status`,
      payload: { status: disabling ? "disabled" : "active" },
      body: `«${l.business_name} — ${l.name}» — ${
        disabling ? t.confirmDisableBranch : t.confirmEnableBranch
      }`,
      confirmLabel: disabling ? t.disable : t.enable,
      danger: disabling,
    });
  };

  return (
    <>
      <div className="row mb-14">
        <input
          placeholder={`${t.branch} / ${t.address}…`}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          className="max-w-280"
          aria-label={t.branch}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t.status}>
          <option value="">{t.statusAll}</option>
          <option value="active">{t.stActive}</option>
          <option value="disabled">{t.stDisabled}</option>
          <option value="under_review">{t.stUnderReviewShort}</option>
        </select>
        {businessFilter && (
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
              <th>{t.branch}</th>
              <th>{t.businessesTab}</th>
              <th>{t.status}</th>
              <th>{t.liveAds}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.results.map((l) => (
              <tr key={l.id}>
                <td className="max-w-240 wrap-anywhere">
                  <strong>{l.name}</strong>
                  <div className="muted-2">{l.address}</div>
                  {l.risk_flags.length > 0 && (
                    <div>
                      {l.risk_flags.map((f) => (
                        <span key={f} className="chip orange">
                          {f === "duplicate_claim" ? t.riskDuplicateClaim : f}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="muted-2">
                  {l.business_name}
                  {l.business_status !== "active" && (
                    <div>
                      <StatusChip status={l.business_status} />
                    </div>
                  )}
                </td>
                <td>
                  <StatusChip status={l.status} />
                </td>
                <td>{l.live_ads}</td>
                <td>
                  <div className="row">
                    <button className="btn small" onClick={() => link.go("placements", { location: l.id })}>
                      {t.viewPlacements}
                    </button>
                    <button
                      className="btn small"
                      onClick={() => link.go("logs", { entity: "location", entity_id: l.id })}
                    >
                      {t.viewLog}
                    </button>
                    <Link className="btn small" to={`/locations/${l.id}`}>
                      <IconExternal size={12} />
                    </Link>
                    {l.status !== "under_review" && (
                      <button
                        className={`btn small${l.status === "active" ? " danger" : ""}`}
                        disabled={action.busy}
                        onClick={() => void toggle(l)}
                      >
                        {l.status === "active" ? <IconBlock size={12} /> : <IconCheck size={12} />}{" "}
                        {l.status === "active" ? t.disable : t.enable}
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
    </>
  );
}
