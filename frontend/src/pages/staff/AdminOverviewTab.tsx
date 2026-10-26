import { useAdminOverview } from "@/shared/api/queries";
import { formatMinor } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import {
  IconAlert,
  IconBlock,
  IconCheck,
  IconClock,
  IconEye,
  IconFlag,
  IconMoney,
  IconUsers,
} from "@/shared/icons";
import { useStaffLink } from "./controls";
import { QueryError } from "@/shared/ui";

export function AdminOverviewTab() {
  const { t, locale } = useI18n();
  const { data, isLoading, isError, refetch } = useAdminOverview(true);
  const lang = locale as "ru" | "uz";
  const link = useStaffLink();
  if (isLoading) return <div className="skeleton skeleton-card" />;
  if (isError) return <QueryError onRetry={() => refetch()} />;
  if (!data) return null;
  const a = data.attention;
  // Each counter deep-links to the tab + filter where it gets resolved.
  const attention: [number, string, string, Record<string, string>, boolean][] = [
    [a.capacity_blocked, t.attnCapacityBlocked, "placements", { state: "blocked" }, true],
    [a.staff_blocked, t.attnStaffBlocked, "placements", { state: "blocked" }, false],
    [a.blocked_users, t.attnBlockedUsers, "users", { status: "blocked" }, false],
    [a.disabled_businesses, t.attnDisabledBusinesses, "businesses", { status: "disabled" }, false],
    [a.disabled_locations, t.attnDisabledBranches, "businesses", { view: "branches", status: "disabled" }, false],
  ];
  const open = attention.filter(([n]) => n > 0);
  // Summary counters open the section (and filter) they count.
  const stats: {
    icon: React.ReactNode;
    value: React.ReactNode;
    label: string;
    tab: string;
    params?: Record<string, string>;
    money?: boolean;
  }[] = [
    { icon: <IconClock size={22} />, value: data.queue_depth, label: t.pendingReview, tab: "queue" },
    { icon: <IconFlag size={22} />, value: data.open_reports, label: t.openReports, tab: "reports" },
    { icon: <IconMoney size={22} />, value: data.refunds_requested, label: t.refundsPending, tab: "refunds" },
    {
      icon: <IconEye size={22} />,
      value: data.active_placements,
      label: t.activePlacements,
      tab: "placements",
      params: { state: "active" },
    },
    {
      icon: <IconMoney size={22} />,
      value: formatMinor(data.revenue.month, "UZS", lang),
      label: t.thisMonth,
      tab: "orders",
      params: { state: "paid" },
      money: true,
    },
    { icon: <IconUsers size={22} />, value: data.owners, label: t.ownersCount, tab: "businesses" },
  ];
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
        {stats.map(({ icon, value, label, tab, params, money }) => (
          <button
            key={label}
            type="button"
            className="stat-card staff-attn"
            onClick={() => link.go(tab, params)}
          >
            <span className="icon">{icon}</span>
            <span className={money ? "num num-lg" : "num"}>{value}</span>
            <span className="muted-2">{label}</span>
          </button>
        ))}
      </div>
      <p className="muted-2 mt-10">
        {t.totalSpent}: {formatMinor(data.revenue.total, "UZS", lang)}
      </p>
    </section>
  );
}
