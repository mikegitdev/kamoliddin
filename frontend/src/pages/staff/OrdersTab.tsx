import { useEffect, useState } from "react";
import { useStaffPage, type ApiAdminOrder } from "@/shared/api/queries";
import { formatDateTime, formatMinor } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { OrderChip } from "@/shared/ui";
import type { OrderState } from "@/entities/types";
import { IconCheck } from "@/shared/icons";
import {
  FilterPill,
  ServerPager,
  shortId,
  useDebounced,
  useStaffLink,
} from "./controls";

export function OrdersTab({ locale }: { locale: string }) {
  const { t } = useI18n();
  const lang = locale as "ru" | "uz";
  const link = useStaffLink();
  const business = link.get("business");
  const [qInput, setQInput] = useState("");
  const q = useDebounced(qInput);
  const [state, setState] = useState(() => link.get("state"));
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [q, state, business]);
  const { data, isLoading } = useStaffPage<ApiAdminOrder>("orders", { q, state, business }, offset);

  return (
    <section>
      <div className="row mb-14">
        <input
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
      </div>
      {isLoading && <div className="skeleton skeleton-card" />}
      {data && data.count > 0 && (
        <p className="muted-2 mb-10">
          {t.countLabel}: {data.count}
        </p>
      )}
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
              <th>{t.secSchedule}</th>
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
                  <div className="row">
                    {o.attempts_count > 0 && (
                      <button
                        className="btn small"
                        onClick={() => link.go("logs", { view: "payments", order: o.id })}
                      >
                        {t.viewOrderPayments} ({o.attempts_count})
                      </button>
                    )}
                    <button className="btn small" onClick={() => link.go("campaigns", { business: o.business_id })}>
                      {t.campaignsTab}
                    </button>
                    <button
                      className="btn small"
                      onClick={() => link.go("logs", { entity: "order", entity_id: o.id })}
                    >
                      {t.viewLog}
                    </button>
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
