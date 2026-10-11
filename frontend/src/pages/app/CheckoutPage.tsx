import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrder } from "@/shared/api/queries";
import { ApiError } from "@/shared/api/client";
import { checkoutOrder, completeFakePayment } from "@/features/advertiser/api";
import { formatDateTime, formatMinor } from "@/shared/format";
import { OrderChip } from "@/shared/ui";
import { IconArrowLeft, IconCheck } from "@/shared/icons";
import { useI18n } from "@/shared/i18n";
import type { ApiCheckout } from "@/entities/types";

export function CheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const { data: order, isLoading } = useOrder(id);
  const [checkoutRes, setCheckoutRes] = useState<ApiCheckout | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkout = useMutation({
    mutationFn: () => checkoutOrder(id!, `${window.location.origin}/app/billing`),
    onSuccess: (res) => {
      setCheckoutRes(res);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["order", id] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t.error),
  });

  const pay = useMutation({
    mutationFn: () => completeFakePayment(checkoutRes!.redirect_url),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t.error),
  });

  if (isLoading) {
    return (
      <section className="form">
        <div className="skeleton skeleton-line w60" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-card" style={{ marginTop: 12 }} />
      </section>
    );
  }
  if (!order) {
    return (
      <section className="form">
        <div className="callout danger" role="alert">
          {t.orderMissing}
        </div>
        <p style={{ marginTop: 14 }}>
          <Link to="/app/campaigns"><IconArrowLeft size={14} /> {t.backToCampaigns}</Link>
        </p>
      </section>
    );
  }

  const unpaid = ["draft_quote", "awaiting_payment"].includes(order.state);
  const isPaid = order.state === "paid";
  const processing = order.state === "payment_processing";
  const showFakePay = !!checkoutRes && checkoutRes.provider === "fake";
  const showExternal = !!checkoutRes && checkoutRes.provider !== "fake";

  return (
    <section className="form">
      <div className="row-between">
        <h2>
          {t.checkout} · {t.order}
        </h2>
        <OrderChip state={order.state} />
      </div>
      <p className="muted" style={{ marginBottom: 4 }}>
        {order.campaign_headline} · {order.business_name}
      </p>
      <div className="info-grid" style={{ margin: "12px 0" }}>
        <div className="info-card">
          <div className="label">{t.schedulePeriod}</div>
          <div className="value">
            {formatDateTime(order.interval_start_at, locale)} —{" "}
            {formatDateTime(order.interval_end_at, locale)}
          </div>
        </div>
        {order.quote_expires_at && (
          <div className="info-card">
            <div className="label">{t.quoteValidUntil}</div>
            <div className="value">{formatDateTime(order.quote_expires_at, locale)}</div>
          </div>
        )}
        {order.auto_renew && (
          <div className="info-card">
            <div className="label">{t.autoRenew}</div>
            <div className="value">{t.autoRenewHint}</div>
          </div>
        )}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.branches}</th>
              <th>{t.perDay}</th>
              <th>{t.days}</th>
              <th>{t.total}</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.location}>
                <td>{item.location_name}</td>
                <td>{formatMinor(item.unit_rate_snapshot, order.currency, locale)}</td>
                <td>{item.charge_days}</td>
                <td>{formatMinor(item.line_total, order.currency, locale)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                <strong>{t.total}</strong>
              </td>
              <td>
                <strong>{formatMinor(order.amount_total, order.currency, locale)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {unpaid && !checkoutRes && (
        <div className="form-actions">
          <button
            className="btn primary"
            disabled={checkout.isPending}
            onClick={() => checkout.mutate()}
          >
            {checkout.isPending ? t.loading : t.createPayment}
          </button>
        </div>
      )}
      {showFakePay && (
        <div className="form-actions">
          <button className="btn primary" disabled={pay.isPending} onClick={() => pay.mutate()}>
            {pay.isPending ? t.verifying : t.simulatePayment}
          </button>
        </div>
      )}
      {showExternal && (
        <div className="form-actions">
          <a className="btn primary" href={checkoutRes.redirect_url}>
            {t.payExternal}
          </a>
        </div>
      )}
      {processing && (
        <p className="muted" role="status">
          {t.checkingPayment}
        </p>
      )}
      {isPaid && (
        <div className="callout ok" role="status">
          <span>
            <IconCheck size={14} /> {t.paymentDone}. {t.afterApprovalHint}.
          </span>
        </div>
      )}
      {order.state === "expired" && (
        <p className="error" role="alert">
          {t.quoteExpired}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p>
        <Link to="/app/campaigns"><IconArrowLeft size={14} /> {t.backToCampaigns}</Link>
      </p>
    </section>
  );
}
