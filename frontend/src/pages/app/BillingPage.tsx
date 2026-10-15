import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrders, useRenewals } from "@/shared/api/queries";
import { ApiError } from "@/shared/api/client";
import { cancelRenewal, enableRenewal, requestRefund } from "@/features/advertiser/api";
import { formatDateTime, formatMinor } from "@/shared/format";
import { OrderChip } from "@/shared/ui";
import { confirmDialog, mountDialog, RefundDialogBody } from "@/shared/dialog";
import { IconCheck } from "@/shared/icons";
import { useI18n } from "@/shared/i18n";
import type { ApiRenewal } from "@/entities/types";

const PAGE_SIZE = 20;

const RENEWAL_LABEL: Record<string, "renewalActive" | "renewalAlert" | "renewalDisabled"> = {
  active: "renewalActive",
  alert: "renewalAlert",
  disabled: "renewalDisabled",
};

const RENEWAL_CHIP: Record<string, string> = {
  active: "chip green",
  alert: "chip orange",
  disabled: "chip gray",
};

function RenewalRow({ renewal }: { renewal: ApiRenewal }) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();

  const cancel = useMutation({
    mutationFn: () => cancelRenewal(renewal.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["renewals"] }),
  });
  const enable = useMutation({
    mutationFn: () => enableRenewal(renewal.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["renewals"] }),
  });

  const pending = cancel.isPending || enable.isPending;
  const failed =
    (cancel.isError || enable.isError) &&
    (cancel.error instanceof ApiError || enable.error instanceof ApiError)
      ? ((cancel.error ?? enable.error) as ApiError).message
      : cancel.isError || enable.isError
        ? t.error
        : null;

  const toggle = async () => {
    const cancelling = renewal.status !== "disabled";
    const ok = await confirmDialog({
      t,
      body: cancelling ? t.confirmCancelRenewal : t.confirmEnableRenewal,
      confirmLabel: cancelling ? t.cancelRenewal : t.enableRenewal,
      cancelLabel: t.cancel,
    });
    if (!ok) return;
    if (cancelling) cancel.mutate();
    else enable.mutate();
  };

  return (
    <li className="renewal-row">
      <div className="row-between items-start">
        <div className="min-w-0 stack-text">
          <strong className="wrap-anywhere">{renewal.campaign_headline}</strong>
          <span className="muted-2">
            {renewal.locations_count} {t.locationsCount} · {renewal.charge_days} {t.days} ·{" "}
            {t.nextCharge}: {formatDateTime(renewal.next_run_at, locale)}
          </span>
        </div>
        <div className="row justify-end">
          <span className={RENEWAL_CHIP[renewal.status] ?? "chip gray"}>
            {t[RENEWAL_LABEL[renewal.status] as "renewalActive"]}
          </span>
          <button
            className="btn small"
            disabled={pending}
            onClick={() => void toggle()}
            title={t.paidTimeStays}
          >
            {pending
              ? t.loading
              : renewal.status !== "disabled"
                ? t.cancelRenewal
                : t.enableRenewal}
          </button>
        </div>
      </div>
      {failed && (
        <p className="error" role="alert">
          {failed}
        </p>
      )}
    </li>
  );
}

export function BillingPage() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const { data: orders } = useOrders();
  const { data: renewals } = useRenewals();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const refund = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      requestRefund(orderId, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
  });

  /** Refund with a user-typed reason (the moderator reads it verbatim) —
   *  presets cover the common rejected-campaign case. */
  const openRefundDialog = (orderId: string) => {
    void mountDialog((close) => (
      <RefundDialogBody
        t={t}
        locale={locale}
        onSubmit={async (reason) => {
          await refund.mutateAsync({ orderId, reason });
        }}
        close={close}
      />
    ));
  };

  const paidTotal = (orders ?? [])
    .filter((o) => o.state === "paid")
    .reduce((sum, o) => sum + o.amount_total, 0);

  return (
    <section>
      <h2>{t.ordersSection}</h2>

      {orders && orders.length > 0 && (
        <p className="billing-total">
          <span className="muted">{t.paidTotal}:</span>{" "}
          <strong>
            {formatMinor(paidTotal, orders[0].currency, locale)}
          </strong>{" "}
          <span className="muted-2 billing-count">· {t.countLabel}: {orders.length}</span>
        </p>
      )}

      {orders && orders.length === 0 && <p className="muted">{t.noOrders}</p>}
      {orders && orders.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.order}</th>
                <th>{t.campaigns}</th>
                <th>{t.total}</th>
                <th>{t.status}</th>
                <th>{t.refundState}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, visibleCount).map((order) => {
                const refundable = order.state === "paid" && order.campaign_status === "rejected";
                const refundDone = refund.isSuccess && refund.variables?.orderId === order.id;
                return (
                  <tr key={order.id}>
                    <td data-label={t.order}>
                      <div>
                        <Link to={`/app/orders/${order.id}`} className="muted-2" title={order.id}>
                          …{order.id.slice(0, 8)}
                        </Link>
                        <div className="muted-2">{formatDateTime(order.created_at, locale)}</div>
                      </div>
                    </td>
                    <td data-label={t.campaigns} className="max-w-220 wrap-anywhere">
                      <Link to={`/app/orders/${order.id}`}>{order.campaign_headline}</Link>
                    </td>
                    <td data-label={t.total}>{formatMinor(order.amount_total, order.currency, locale)}</td>
                    <td data-label={t.status}>
                      <OrderChip state={order.state} />
                    </td>
                    <td data-label={t.refundState}>
                      {order.state === "expired" ? (
                        <span className="muted-2">—</span>
                      ) : refundable ? (
                        <button
                          className="btn small"
                          disabled={refund.isPending && refund.variables?.orderId === order.id}
                          onClick={() => openRefundDialog(order.id)}
                        >
                          {refund.isPending && refund.variables?.orderId === order.id
                            ? t.sending
                            : t.requestRefund}
                        </button>
                      ) : refundDone ? (
                        <span className="ok"><IconCheck size={12} /> {t.refundSent}</span>
                      ) : (
                        <span className="muted-2">—</span>
                      )}
                      {refund.isError && refund.variables?.orderId === order.id && (
                        <span className="error" role="alert">
                          {refund.error instanceof ApiError ? refund.error.message : t.error}
                        </span>
                      )}
                    </td>
                    <td>
                      {["draft_quote", "awaiting_payment"].includes(order.state) && (
                        <Link className="btn small" to={`/app/checkout/${order.id}`}>
                          {t.checkout}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {orders && orders.length > visibleCount && (
        <p className="cc-more-row">
          <button className="btn subtle small" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
            {t.showMore} ({orders.length - visibleCount})
          </button>
        </p>
      )}

      {renewals && renewals.length > 0 && (
        <>
          <hr className="divider" />
          <h2>{t.renewals}</h2>
          <ul className="list">
            {renewals.map((r) => (
              <RenewalRow key={r.id} renewal={r} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
