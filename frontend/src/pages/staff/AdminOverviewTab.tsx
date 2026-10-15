import { useAdminOverview } from "@/shared/api/queries";
import { formatMinor } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import {
  IconAlert,
  IconBlock,
  IconCheck,
  IconClock,
  IconFlag,
  IconMoney,
  IconOrb,
  IconUsers,
} from "@/shared/icons";
import { useStaffLink } from "./controls";

export function AdminOverviewTab() {
  const { t, locale } = useI18n();
  const { data, isLoading } = useAdminOverview(true);
  const lang = locale as "ru" | "uz";
  const link = useStaffLink();
  if (isLoading) return <div className="skeleton skeleton-card" />;
  if (!data) return null;
  const a = data.attention;
  // Each counter deep-links to the tab + filter where it gets resolved.
  const attention: [number, string, string, Record<string, string>, boolean][] = [
    [a.renewal_reconciliation, t.attnReconciliation, "logs", { view: "renewals" }, true],
    [a.capacity_blocked, t.attnCapacityBlocked, "placements", { state: "blocked" }, true],
    [a.renewal_alerts, t.attnRenewalAlerts, "logs", { view: "renewals" }, false],
    [a.staff_blocked, t.attnStaffBlocked, "placements", { state: "blocked" }, false],
    [a.blocked_users, t.attnBlockedUsers, "users", { status: "blocked" }, false],
    [a.disabled_businesses, t.attnDisabledBusinesses, "businesses", { status: "disabled" }, false],
    [a.disabled_locations, t.attnDisabledBranches, "businesses", { view: "branches", status: "disabled" }, false],
  ];
  const open = attention.filter(([n]) => n > 0);
  return (
    <section>
      <h3 className="mb-10">{t.attnTitle}</h3>
      {open.length === 0 ? (
        <p className="callout mb-14">
          <IconCheck size={16} /> {t.attnAllClear}
        </p>
      ) : (
        <div className="cards staff-attn-grid mb-14">
          {open.map(([n, label, tab, params, urgent]) => (
            <button
              key={label}
              type="button"
              className={`stat-card staff-attn${urgent ? " urgent" : ""}`}
              onClick={() => link.go(tab, params)}
            >
              <span className="icon">
                {urgent ? <IconAlert size={22} /> : <IconBlock size={22} />}
              </span>
              <span className="num">{n}</span>
              <span className="muted-2">{label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="cards">
        <div className="stat-card">
          <span className="icon"><IconClock size={22} /></span>
          <span className="num">{data.queue_depth}</span>
          <span className="muted-2">{t.pendingReview}</span>
        </div>
        <div className="stat-card">
          <span className="icon"><IconFlag size={22} /></span>
          <span className="num">{data.open_reports}</span>
          <span className="muted-2">{t.openReports}</span>
        </div>
        <div className="stat-card">
          <span className="icon"><IconMoney size={22} /></span>
          <span className="num">{data.refunds_requested}</span>
          <span className="muted-2">{t.refundsPending}</span>
        </div>
        <div className="stat-card">
          <span className="icon"><IconOrb size={22} /></span>
          <span className="num">{data.active_placements}</span>
          <span className="muted-2">{t.activePlacements}</span>
        </div>
        <div className="stat-card">
          <span className="icon"><IconMoney size={22} /></span>
          <span className="num num-lg">
            {formatMinor(data.revenue.month, "UZS", lang)}
          </span>
          <span className="muted-2">{t.thisMonth}</span>
        </div>
        <div className="stat-card">
          <span className="icon"><IconUsers size={22} /></span>
          <span className="num">{data.owners}</span>
          <span className="muted-2">{t.ownersCount}</span>
        </div>
      </div>
      <p className="muted-2 mt-10">
        {t.totalSpent}: {formatMinor(data.revenue.total, "UZS", lang)}
      </p>
    </section>
  );
}
