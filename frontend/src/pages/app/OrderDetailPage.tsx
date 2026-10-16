import { Link, useParams } from "react-router-dom";
import { ApiError } from "@/shared/api/client";
import { useOrder } from "@/shared/api/queries";
import { formatDateTime, formatMinor } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { AttemptChip, CopyButton, OrderChip, RefundStateChip, QueryError } from "@/shared/ui";
import {
  IconArrowLeft,
  IconBulb,
  IconCalendar,
  IconCard,
  IconClock,
  IconLab,
  IconMegaphone,
  IconPrint,
} from "@/shared/icons";

/** Order detail: line items, payment timeline, refund (spec §5). */
export function OrderDetailPage() {
  const { t, locale } = useI18n();
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading, isError, error, refetch } = useOrder(id);
  const lang = locale as "ru" | "uz";

  if (isLoading) {
    return (
      <section>
        <div className="skeleton skeleton-card" />
      </section>
    );
  }
  if (!order) {
    // Only a 404 means "not found"; network/server failures get a retry.
    const failed = isError && !(error instanceof ApiError && error.status === 404);
    return (
      <section>
        {failed ? (
          <QueryError onRetry={() => refetch()} />
        ) : (
          <p className="callout">{t.notFound}</p>
        )}
        <Link className="btn" to="/app/billing">
          <IconArrowLeft size={14} /> {t.billing}
        </Link>
      </section>
    );
  }

  return (
    <section>
      <div className="row-between mb-14">
        <Link className="btn small" to="/app/billing">
          <IconArrowLeft size={14} /> {t.billing}
        </Link>
        <div className="row">
          <CopyButton value={order.id} />
          <Link className="btn small" to={`/app/campaigns/${order.campaign}`}>
            <IconMegaphone size={14} /> {order.campaign_headline}
          </Link>
          {/* Printable receipt (document download is backend-gated; print is
              the shareable stopgap). */}
          <button className="btn subtle small hide-mobile" onClick={() => window.print()}>
            <IconPrint size={12} /> {t.printReceipt}
          </button>
        </div>
      </div>

      <div className="order-id-line muted-2">
        {t.orderLabel}: <span className="mono">{order.id}</span>
      </div>

      <div className="cards">
        <div className="stat-card">
          <span className="icon"><IconCard size={22} /></span>
          <span className="num">{formatMinor(order.amount_total, order.currency, lang)}</span>
          <span className="muted-2">
            <OrderChip state={order.state} />
          </span>
        </div>
        <div className="stat-card">
          <span className="icon"><IconCalendar size={22} /></span>
          <span className="num num-date">
            {formatDateTime(order.interval_start_at, lang)}
          </span>
          <span className="muted-2">→ {formatDateTime(order.interval_end_at, lang)}</span>
        </div>
        <div className="stat-card">
          <span className="icon"><IconClock size={22} /></span>
          <span className="num stat-chip-row">
            <span className={`chip ${order.auto_renew ? "green" : "gray"}`}>
              {order.auto_renew ? t.renewalActive : t.renewalDisabled}
            </span>
          </span>
          <span className="muted-2">{t.secRenewal}</span>
        </div>
      </div>

      <h2 className="mt-20">{t.secBranches}</h2>
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
                <td data-label={t.branch}>{item.location_name}</td>
                <td className="muted-2" data-label={t.perDay}>{formatMinor(item.unit_rate_snapshot, order.currency, lang)}</td>
                <td className="muted-2" data-label={t.days}>{item.charge_days} × 24{t.hoursShort}</td>
                <td data-label={t.total}>{formatMinor(item.line_total, order.currency, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-20">{t.paymentHistory}</h2>
      {order.attempts.length === 0 && <p className="callout"><IconBulb size={16} /> {t.noAttempts}</p>}
      <ul className="list">
        {order.attempts.map((a) => (
          <li key={a.id} className="row-between">
            <div>
              <strong>{a.provider === "fake" ? (<><IconLab size={12} /> {t.providerFake}</>) : a.provider}</strong>
              <div className="muted-2">
                {formatMinor(a.amount, order.currency, lang)} ·{" "}
                {formatDateTime(a.created_at, lang)}
              </div>
            </div>
            <AttemptChip status={a.status} />
          </li>
        ))}
      </ul>

      {order.refund && (
        <>
          <h2 className="mt-20">{t.refunds}</h2>
          <div className="review-card">
            <div className="review-body">
              <div className="row-between">
                <strong>{t.requestRefund}</strong>
                <RefundStateChip state={order.refund.state} />
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
