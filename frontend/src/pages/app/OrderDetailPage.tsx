import { Link, useParams } from "react-router-dom";
import { useOrder } from "@/shared/api/queries";
import { formatDateTime, formatMinor } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import {
  IconArrowLeft,
  IconBulb,
  IconCalendar,
  IconCard,
  IconLab,
  IconMegaphone,
} from "@/shared/icons";

const ATTEMPT_CLASS: Record<string, string> = {
  succeeded: "green",
  pending: "orange",
  failed: "red",
};

/** Order detail: line items, payment timeline, refund (spec §5). */
export function OrderDetailPage() {
  const { t, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading } = useOrder(id);
  const lang = locale as "ru" | "uz";

  if (isLoading) {
    return (
      <section>
        <div className="skeleton skeleton-card" />
      </section>
    );
  }
  if (!order) {
    return (
      <section>
        <p className="callout">{t.notFound}</p>
        <Link className="btn" to="/app/billing">
          <IconArrowLeft size={14} /> {t.billing}
        </Link>
      </section>
    );
  }

  return (
    <section>
      <div className="row-between" style={{ marginBottom: 14 }}>
        <Link className="btn small" to="/app/billing">
          <IconArrowLeft size={14} /> {t.billing}
        </Link>
        <Link className="btn small" to={`/app/campaigns/${order.campaign}`}>
          <IconMegaphone size={14} /> {order.campaign_headline}
        </Link>
      </div>

      <div className="cards">
        <div className="stat-card">
          <span className="icon"><IconCard size={22} /></span>
          <span className="num">{formatMinor(order.amount_total, order.currency, lang)}</span>
          <span className="muted-2">{order.state}</span>
        </div>
        <div className="stat-card">
          <span className="icon"><IconCalendar size={22} /></span>
          <span className="num" style={{ fontSize: "1rem" }}>
            {formatDateTime(order.interval_start_at, lang)}
          </span>
          <span className="muted-2">→ {formatDateTime(order.interval_end_at, lang)}</span>
        </div>
        <div className="stat-card">
          <span className="icon"><IconCard size={22} /></span>
          <span className="num" style={{ fontSize: "1rem" }}>
            {order.auto_renew ? t.renewalActive : t.renewalDisabled}
          </span>
          <span className="muted-2">{t.secRenewal}</span>
        </div>
      </div>

      <h2 style={{ marginTop: 20 }}>{t.secBranches}</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.branch}</th>
              <th>{t.perDay}</th>
              <th>{t.days}</th>
              <th>{t.total}</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.location}>
                <td>{item.location_name}</td>
                <td className="muted-2">{formatMinor(item.unit_rate_snapshot, order.currency, lang)}</td>
                <td className="muted-2">{item.charge_days} × 24{t.hoursShort}</td>
                <td>{formatMinor(item.line_total, order.currency, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 20 }}>{t.paymentHistory}</h2>
      {order.attempts.length === 0 && <p className="callout"><IconBulb size={16} /> {t.noAttempts}</p>}
      <ul className="list">
        {order.attempts.map((a) => (
          <li key={a.id} className="row-between">
            <div>
              <strong>{a.provider === "fake" ? (<><IconLab size={12} /> fake</>) : a.provider}</strong>
              <div className="muted-2">
                {formatMinor(a.amount, order.currency, lang)} ·{" "}
                {formatDateTime(a.created_at, lang)}
              </div>
            </div>
            <span className={`chip ${ATTEMPT_CLASS[a.status] ?? "gray"}`}>{a.status}</span>
          </li>
        ))}
      </ul>

      {order.refund && (
        <>
          <h2 style={{ marginTop: 20 }}>{t.refunds}</h2>
          <div className="review-card">
            <div className="review-body">
              <div className="row-between">
                <strong>{t.requestRefund}</strong>
                <span className={`chip ${order.refund.state === "refunded" ? "green" : "orange"}`}>
                  {order.refund.state}
                </span>
              </div>
              <p className="muted-2">{order.refund.reason}</p>
              <div className="muted-2">
                {formatMinor(order.refund.amount, order.currency, lang)} ·{" "}
                {formatDateTime(order.refund.created_at, lang)}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
