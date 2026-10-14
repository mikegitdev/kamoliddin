import { useActivity } from "@/shared/api/queries";
import { formatDateTime } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { IconCheck } from "@/shared/icons";
import { MoreRow, useShowMore } from "./pager";

export function ActivityTab({ locale }: { locale: string }) {
  const { t } = useI18n();
  const { data: events, isLoading } = useActivity(true);
  const lang = locale as "ru" | "uz";
  const pager = useShowMore(events, 25);
  return (
    <section>
      {isLoading && <div className="skeleton skeleton-card" />}
      {events && events.length > 0 && (
        <p className="muted-2 mb-10">
          {t.countLabel}: {events.length}
        </p>
      )}
      {events && events.length === 0 && (
        <p className="callout"><IconCheck size={16} /> {t.nothingHere}</p>
      )}
      <ul className="list">
        {pager.visible.map((e) => (
          <li key={e.id} className="row-between">
            <div className="min-w-0">
              <strong>{e.action}</strong>
              <div className="muted-2">
                {e.entity}:{e.entity_id.slice(0, 8)} ·{" "}
                {e.actor_phone ?? "system"}
              </div>
            </div>
            <span className="muted-2">{formatDateTime(e.created_at, lang)}</span>
          </li>
        ))}
      </ul>
      <MoreRow hidden={pager.hidden} onMore={pager.showMore} />
    </section>
  );
}
