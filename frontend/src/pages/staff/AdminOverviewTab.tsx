import { useAdminOverview } from "@/shared/api/queries";
import { formatMinor } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import {
  IconClock,
  IconFlag,
  IconMoney,
  IconOrb,
  IconUsers,
} from "@/shared/icons";

export function AdminOverviewTab() {
  const { t, locale } = useI18n();
  const { data, isLoading } = useAdminOverview(true);
  const lang = locale as "ru" | "uz";
  if (isLoading) return <div className="skeleton skeleton-card" />;
  if (!data) return null;
  return (
    <section>
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
