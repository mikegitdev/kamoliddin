import { useStaffPage, type ApiAdminOrder } from "@/shared/api/queries";
import { formatDateTime, formatMinor } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { OrderChip, QueryError } from "@/shared/ui";
import type { OrderState } from "@/entities/types";
import { IconCheck } from "@/shared/icons";
import {
  FilterPill,
  ListCount,
  RowMenu,
  ServerPager,
  shortId,
  useDebounced,
  useHistoryState,
  usePagedOffset,
  useStaffLink,
} from "./controls";

export function OrdersTab({ locale }: { locale: string }) {
  const { t } = useI18n();
  const lang = locale as "ru" | "uz";
  const link = useStaffLink();
  const business = link.get("business");
  const [qInput, setQInput] = useHistoryState("orders.q", "");
  const q = useDebounced(qInput);
  const [state, setState] = useHistoryState("orders.state", () => link.get("state"));
  const [offset, setOffset] = usePagedOffset("orders.offset", [q, state, business]);
  const { data, isLoading, isError, refetch } = useStaffPage<ApiAdminOrder>("orders", { q, state, business }, offset);

  return (
    <section>
      <div className="staff-toolbar">
        <input
          type="search"
          placeholder={`${t.businessesTab} / ${t.campaign} / ID…`}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          className="max-w-280"
          aria-label={t.search}
        />
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label={t.status}>
          <option value="">{t.statusAll}</option>
          <option value="paid">{t.stPaid}</option>
          <option value="awaiting_payment">{t.stAwaiting}</option>
          <option value="payment_processing">{t.stProcessing}</option>
          <option value="failed">{t.stFailed}</option>
          <option value="expired">{t.stExpired}</option>
          <option value="draft_quote">{t.stQuote}</option>
        </select>
        {business && (
          <FilterPill
            label={data?.results[0]?.business_name ?? t.businessesTab}
            onClear={() => link.clear("business")}
          />
        )}
        <ListCount count={data?.count} />
      </div>
      {isLoading && <div className="skeleton skeleton-card" />}
      {isError && <QueryError onRetry={() => refetch()} />}
      {data && data.count === 0 && (
        <p className="callout"><IconCheck size={16} /> {t.nothingHere}</p>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.orderLabel}</th>
              <th>{t.businessesTab}</th>
              <th>{t.campaign}</th>
              <th>{t.total}</th>
              <th>{t.status}</th>
              <th>{t.payDate}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.results.map((o) => (
              <tr key={o.id}>
                <td className="muted-2" title={o.id}>
                  <code>{shortId(o.id)}</code>
                </td>
                <td>{o.business_name}</td>
                <td className="muted-2 max-w-220 wrap-anywhere">{o.campaign_headline}</td>
                <td>{formatMinor(o.amount_total, o.currency, lang)}</td>
                <td>
                  <OrderChip state={o.state as OrderState} />
                </td>
                <td className="muted-2">{formatDateTime(o.created_at, lang)}</td>
                <td>
                  <RowMenu
                    items={[
                      ...(o.attempts_count > 0
                        ? [{
                            label: `${t.viewOrderPayments} (${o.attempts_count})`,
                            onClick: () => link.go("logs", { view: "payments", order: o.id }),
                          }]
                        : []),
                      { label: t.campaignsTab, onClick: () => link.go("campaigns", { business: o.business_id }) },
                      { label: t.viewLog, onClick: () => link.go("logs", { entity: "order", entity_id: o.id }) },
                    ]}
                  />
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
