import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrders, useRenewals } from "@/shared/api/queries";
import { ApiError } from "@/shared/api/client";
import { cancelRenewal, enableRenewal, requestRefund } from "@/features/advertiser/api";
import { formatDateTime, formatMinor } from "@/shared/format";
import { OrderChip } from "@/shared/ui";
import { useI18n } from "@/shared/i18n";
import type { ApiRenewal } from "@/entities/types";

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

  return (
    <li className="row-between" style={{ alignItems: "flex-start" }}>
      <div style={{ minWidth: 0 }}>
        <strong style={{ overflowWrap: "anywhere" }}>{renewal.campaign_headline}</strong>
        <span className="muted-2">
          {renewal.locations_count} {t.locationsCount} · {renewal.charge_days} {t.days} ·{" "}
          {t.nextCharge}: {formatDateTime(renewal.next_run_at, locale)}
        </span>
      </div>
      <div className="row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span className={RENEWAL_CHIP[renewal.status] ?? "chip gray"}>
          {t[RENEWAL_LABEL[renewal.status] as "renewalActive"]}
        </span>
        {renewal.status !== "disabled" ? (
          <button
            className="btn small"
            disabled={pending}
            onClick={() => cancel.mutate()}
            title={t.paidTimeStays}
          >
            {cancel.isPending ? t.loading : t.cancelRenewal}
          </button>
        ) : (
          <button className="btn small" disabled={pending} onClick={() => enable.mutate()}>
            {enable.isPending ? t.loading : t.enableRenewal}
          </button>
        )}
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

  const refund = useMutation({
    mutationFn: ({ orderId }: { orderId: string }) =>
      requestRefund(orderId, "Rejected campaign refund"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
  });

  return (
    <section>
      <h2>{t.ordersSection}</h2>
      {orders && orders.length === 0 && <p className="muted">{t.noOrders}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.order}</th>
              <th>{t.campaigns}</th>
              <th>{t.total}</th>
              <th>{t.overview}</th>
              <th>{t.refundState}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders?.map((order) => {
              const refundable = order.state === "paid" && order.campaign_status === "rejected";
              const refundPending =
                refund.isPending && refund.variables?.orderId === order.id;
              return (
                <tr key={order.id}>
                  <td>{formatDateTime(order.created_at, locale)}</td>
                  <td style={{ maxWidth: 220, overflowWrap: "anywhere" }}>
                    <Link to={`/app/orders/${order.id}`}>{order.campaign_headline}</Link>
                  </td>
                  <td>{formatMinor(order.amount_total, order.currency, locale)}</td>
                  <td>
                    <OrderChip state={order.state} />
                  </td>
                  <td>
                    {refundable && (
                      <button
                        className="btn small"
                        disabled={refundPending}
                        onClick={() => refund.mutate({ orderId: order.id })}
                      >
                        {refundPending ? t.sending : t.requestRefund}
                      </button>
                    )}
                    {refund.isSuccess && refund.variables?.orderId === order.id && (
                      <span className="ok">✓ {t.refundSent}</span>
                    )}
                    {refund.isError && refund.variables?.orderId === order.id && (
                      <span className="error">
                        {refund.error instanceof ApiError ? refund.error.message : t.error}
                      </span>
                    )}
                  </td>
                  <td>
                    {["draft_quote", "awaiting_payment"].includes(order.state) && (
                      <Link to={`/app/checkout/${order.id}`}>{t.checkout}</Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
