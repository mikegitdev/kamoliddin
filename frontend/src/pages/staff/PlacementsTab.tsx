import { useStaffPage, type ApiAdminPlacement } from "@/shared/api/queries";
import { formatDateTime } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { CampaignChip, FallImg, PlacementChip, QueryError } from "@/shared/ui";
import type { CampaignStatus } from "@/entities/types";
import { IconBlock, IconCheck, IconEye } from "@/shared/icons";
import {
  FilterPill,
  ServerPager,
  useDebounced,
  useHistoryState,
  usePagedOffset,
  useStaffAction,
  useStaffLink,
} from "./controls";

/** Every placement on the platform with live public visibility, plus the
 *  per-placement takedown (block) and restore. */
export function PlacementsTab({ locale }: { locale: string }) {
  const { t } = useI18n();
  const lang = locale as "ru" | "uz";
  const link = useStaffLink();
  const business = link.get("business");
  const location = link.get("location");
  const campaign = link.get("campaign");
  const [qInput, setQInput] = useHistoryState("placements.q", "");
  const q = useDebounced(qInput);
  const [state, setState] = useHistoryState("placements.state", () => link.get("state"));
  const [source, setSource] = useHistoryState("placements.source", "");
  const [visibleOnly, setVisibleOnly] = useHistoryState("placements.visibleOnly", false);
  const visible = visibleOnly ? "1" : "";
  const [offset, setOffset] = usePagedOffset(
    "placements.offset",
    [q, state, source, visible, business, location, campaign],
  );
  const { data, isLoading, isError, refetch } = useStaffPage<ApiAdminPlacement>(
    "placements",
    { q, state, source, visible, business, location, campaign },
    offset,
  );
  const action = useStaffAction();
  const first = data?.results[0];

  const blockReasonLabel = (r: string) =>
    r === "admin_takedown" ? t.blockReasonAdmin : r === "capacity_conflict" ? t.blockReasonCapacity : r;

  const toggle = (p: ApiAdminPlacement) => {
    const blocking = p.state !== "blocked";
    return action.run({
      path: `placements/${p.id}/${blocking ? "block" : "unblock"}`,
      body: `«${p.campaign_headline}» @ ${p.location_name} — ${
        blocking ? t.confirmBlockPlacement : t.confirmUnblockPlacement
      }`,
      confirmLabel: blocking ? t.block : t.unblock,
      danger: blocking,
    });
  };

  return (
    <section>
      <div className="row mb-14">
        <input
          placeholder={`${t.campaign} / ${t.branch}…`}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          className="max-w-280"
          aria-label={t.search}
        />
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label={t.status}>
          <option value="">{t.statusAll}</option>
          <option value="active">{t.stPlacementActive}</option>
          <option value="scheduled">{t.stPlacementScheduled}</option>
          <option value="pending">{t.stPlacementPending}</option>
          <option value="blocked">{t.stPlacementBlocked}</option>
          <option value="expired">{t.stPlacementExpired}</option>
          <option value="cancelled">{t.stPlacementCancelled}</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label={t.source}>
          <option value="">{t.source}: {t.statusAll}</option>
          <option value="paid">{t.sourcePaid}</option>
          <option value="grant">{t.sourceGrant}</option>
        </select>
        <button
          type="button"
          className="filter-chip"
          aria-pressed={visibleOnly}
          onClick={() => setVisibleOnly((v) => !v)}
        >
          <IconEye size={12} /> {t.visibleOnly}
        </button>
        {business && (
          <FilterPill label={first?.business_name ?? t.businessesTab} onClear={() => link.clear("business")} />
        )}
        {location && (
          <FilterPill label={first?.location_name ?? t.branch} onClear={() => link.clear("location")} />
        )}
        {campaign && (
          <FilterPill label={first?.campaign_headline ?? t.campaign} onClear={() => link.clear("campaign")} />
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
              <th>{t.branch}</th>
              <th>{t.status}</th>
              <th>{t.interval}</th>
              <th>{t.source}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.results.map((p) => (
              <tr key={p.id}>
                <td className="max-w-240 wrap-anywhere">
                  <div className="row">
                    <FallImg className="thumb" src={p.banner_url} alt="" />
                    <div className="min-w-0">
                      <strong>{p.campaign_headline}</strong>
                      <div>
                        <CampaignChip status={p.campaign_status as CampaignStatus} />
                      </div>
                    </div>
                  </div>
                </td>
                <td className="muted-2">
                  {p.location_name}
                  <div>{p.business_name}</div>
                </td>
                <td>
                  <PlacementChip state={p.state} />
                  {p.block_reason && <div className="muted-2">{blockReasonLabel(p.block_reason)}</div>}
                  <div className={p.visible ? "ok" : "muted-2"}>
                    {p.visible ? (
                      <>
                        <IconEye size={12} /> {t.visibleNow}
                      </>
                    ) : (
                      t.hidden
                    )}
                  </div>
                </td>
                <td className="muted-2">
                  {formatDateTime(p.start_at, lang)}
                  <div>→ {formatDateTime(p.end_at, lang)}</div>
                </td>
                <td className="muted-2">{p.source_type === "grant" ? t.sourceGrant : t.sourcePaid}</td>
                <td>
                  <div className="row">
                    <button
                      className="btn small"
                      onClick={() => link.go("logs", { entity: "placement", entity_id: p.id })}
                    >
                      {t.viewLog}
                    </button>
                    {(p.state === "active" || p.state === "scheduled" ||
                      (p.state === "blocked" && p.block_reason === "admin_takedown")) && (
                      <button
                        className={`btn small${p.state !== "blocked" ? " danger" : ""}`}
                        disabled={action.busy}
                        onClick={() => void toggle(p)}
                      >
                        {p.state !== "blocked" ? <IconBlock size={12} /> : <IconCheck size={12} />}{" "}
                        {p.state !== "blocked" ? t.block : t.unblock}
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
