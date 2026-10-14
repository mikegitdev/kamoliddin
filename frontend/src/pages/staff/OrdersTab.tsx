import { useAdminOrders } from "@/shared/api/queries";
import { formatDateTime, formatMinor } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { OrderChip } from "@/shared/ui";
import type { OrderState } from "@/entities/types";
import { IconCheck } from "@/shared/icons";
import { MoreRow, useShowMore } from "./pager";

export function OrdersTab({ locale }: { locale: string }) {
  const { t } = useI18n();
  const { data: orders, isLoading } = useAdminOrders(true);
  const lang = locale as "ru" | "uz";
  const pager = useShowMore(orders, 25);
  return (
    <section>
      {isLoading && <div className="skeleton skeleton-card" />}
      {orders && orders.length > 0 && (
        <p className="muted-2 mb-10">
          {t.countLabel}: {orders.length}
        </p>
      )}
      {orders && orders.length === 0 && (
        <p className="callout"><IconCheck size={16} /> {t.nothingHere}</p>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.forBusiness}</th>
              <th>{t.campaign}</th>
              <th>{t.total}</th>
              <th>{t.status}</th>
              <th>{t.secSchedule}</th>
            </tr>
          </thead>
          <tbody>
            {pager.visible.map((o) => (
              <tr key={o.id}>
                <td>{o.business_name}</td>
                <td className="muted-2 max-w-220 wrap-anywhere">
                  {o.campaign_headline}
                </td>
                <td>{formatMinor(o.amount_total, o.currency, lang)}</td>
                <td>
                  <OrderChip state={o.state as OrderState} />
                </td>
                <td className="muted-2">{formatDateTime(o.created_at, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MoreRow hidden={pager.hidden} onMore={pager.showMore} />
    </section>
  );
}
