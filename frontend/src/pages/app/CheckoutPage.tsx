import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAwaitingProvider, useOrder } from "@/shared/api/queries";
import { ApiError } from "@/shared/api/client";
import { checkoutOrder } from "@/features/advertiser/api";
import {
  ACCEPTED_NETWORKS,
  NETWORK_LABEL,
  PAY_METHODS,
  ProviderWordmark,
  type PayMethod,
} from "@/features/payments/providers";
import type { DemoPayState } from "@/pages/DemoPayPage";
import { formatDateTime, formatMinor, formatRelative } from "@/shared/format";
import { CopyButton, OrderChip, QueryError } from "@/shared/ui";
import { IconArrowLeft, IconCheck } from "@/shared/icons";
import { useI18n } from "@/shared/i18n";
import type { ApiCheckout } from "@/entities/types";

export function CheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Set by the demo provider page when the customer backs out unpaid.
  const cancelled = (useLocation().state as { paymentCancelled?: boolean } | null)?.paymentCancelled === true;
  const { data: order, isLoading, isError, error: loadError, refetch } = useOrder(id);
  const [checkoutRes, setCheckoutRes] = useState<ApiCheckout | null>(null);
  const [method, setMethod] = useState<PayMethod>("click");
  const [error, setError] = useState<string | null>(null);
  // Re-render every 30s so the quote-expiry countdown stays current.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const checkout = useMutation({
    mutationFn: () =>
      // Return to THIS page after the provider redirect, so the customer sees
      // the payment resolve (the order query polls while processing).
      checkoutOrder(id!, `${window.location.origin}/app/checkout/${id}`),
    onSuccess: (res) => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      if (res.provider === "fake") {
        // Demo stack: open the chosen provider's mock card page, which
        // settles through the fake gateway's callback.
        const state: DemoPayState = { redirectUrl: res.redirect_url, paymentId: res.provider_payment_id };
        navigate(`/pay/${method}/${id}`, { state });
        return;
      }
      setCheckoutRes(res);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t.error),
  });

  if (isLoading) {
    return (
      <section className="form">
        <div className="skeleton skeleton-line w60" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-card mt-12" />
      </section>
    );
  }
  if (!order) {
    return (
      <section className="form">
        {/* Only a 404 means the order is gone; other failures get a retry. */}
        {isError && !(loadError instanceof ApiError && loadError.status === 404) ? (
          <QueryError onRetry={() => refetch()} />
        ) : (
          <div className="callout danger" role="alert">
            {t.orderMissing}
          </div>
        )}
        <p className="mt-14">
          <Link to="/app/campaigns"><IconArrowLeft size={14} /> {t.backToCampaigns}</Link>
        </p>
      </section>
    );
  }

  const unpaid = ["draft_quote", "awaiting_payment"].includes(order.state);
  const isPaid = order.state === "paid";
  // Returned from the provider page (no local checkout session) while its
  // callback is still outstanding — useOrder polls until it resolves.
  const processing = isAwaitingProvider(order) && !checkoutRes && !cancelled;
  const showExternal = !!checkoutRes;
  // The single most time-critical element gets emphasis as expiry nears.
  const quoteMinutesLeft = order.quote_expires_at
    ? Math.round((new Date(order.quote_expires_at).getTime() - Date.now()) / 60_000)
    : null;
  const quoteUrgent = quoteMinutesLeft !== null && quoteMinutesLeft < 60;

  return (
    <section className="form">
      <div className="row-between">
        <h2>
          {t.checkout} · {t.orderLabel} …{(order.id ?? "").slice(0, 8)}
        </h2>
        <div className="row">
          <OrderChip state={order.state} />
          <CopyButton value={order.id} />
        </div>
      </div>
      <p className="muted mb-4">
        {order.campaign_headline} · {order.business_name}
      </p>
      <div className="info-grid my-12">
        <div className="info-card">
          <div className="label">{t.schedulePeriod}</div>
          <div className="value">
            {formatDateTime(order.interval_start_at, locale)} —{" "}
            {formatDateTime(order.interval_end_at, locale)}
          </div>
        </div>
        {order.quote_expires_at && order.state !== "expired" && (
          <div className={`info-card${quoteUrgent ? " quote-urgent" : ""}`}>
            <div className="label">{t.quoteValidUntil}</div>
            <div className="value">
              {quoteUrgent && <strong>{t.expiresSoonLabel}: </strong>}
              {formatDateTime(order.quote_expires_at, locale)}
              <span className="muted-2"> ({t.quoteExpiresIn} {formatRelative(order.quote_expires_at, locale)})</span>
            </div>
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
                <td data-label={t.branches}>{item.location_name}</td>
                <td data-label={t.perDay}>{formatMinor(item.unit_rate_snapshot, order.currency, locale)}</td>
                <td data-label={t.days}>{item.charge_days}</td>
                <td data-label={t.total}>{formatMinor(item.line_total, order.currency, locale)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} data-label="">
                <strong>{t.total}</strong>
              </td>
              <td data-label={t.total}>
                <strong>{formatMinor(order.amount_total, order.currency, locale)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* The money decision: amount rests right beside the action. */}
      {(unpaid || showExternal) && (
        <div className="checkout-total">
          <span className="muted">{t.total}</span>
          <strong>{formatMinor(order.amount_total, order.currency, locale)}</strong>
        </div>
      )}

      {cancelled && unpaid && !checkoutRes && (
        <div className="callout" role="status">
          <span>{t.paymentCancelled}</span>
        </div>
      )}

      {unpaid && !checkoutRes && (
        <>
          <fieldset className="pay-methods">
            <legend>{t.payMethodTitle}</legend>
            <div className="pay-method-grid">
              {PAY_METHODS.map((m) => (
                <label key={m} className={`pay-method${method === m ? " selected" : ""}`}>
                  <input
                    className="sr-only"
                    type="radio"
                    name="pay-method"
                    value={m}
                    checked={method === m}
                    onChange={() => setMethod(m)}
                  />
                  <ProviderWordmark method={m} />
                  <span className="pay-method-cards">
                    {ACCEPTED_NETWORKS[m].map((n) => NETWORK_LABEL[n]).join(" · ")}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="form-actions">
            <button
              className="btn primary"
              disabled={checkout.isPending}
              onClick={() => checkout.mutate()}
            >
              {checkout.isPending ? (
                <>
                  <span className="spinner" aria-hidden="true" /> {t.loading}
                </>
              ) : (
                `${t.payAmount} ${formatMinor(order.amount_total, order.currency, locale)}`
              )}
            </button>
          </div>
        </>
      )}
      {showExternal && (
        <div className="form-actions stack">
          <a className="btn primary" href={checkoutRes.redirect_url}>
            {t.payExternal}
          </a>
          <span className="muted-2">{t.redirectNote}</span>
        </div>
      )}
      {processing && (
        <p className="muted" role="status">
          <span className="spinner inline" aria-hidden="true" /> {t.checkingPayment} {t.paymentAutoCheck}
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
