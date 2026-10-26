import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api/client";
import { useRefunds } from "@/shared/api/queries";
import { formatDateTime, formatMinor } from "@/shared/format";
import { confirmDialog, reasonDialog } from "@/shared/dialog";
import { useI18n } from "@/shared/i18n";
import { RefundStateChip, QueryError } from "@/shared/ui";
import { IconCheck, IconReject } from "@/shared/icons";
import { MoreRow, useShowMore } from "./pager";

export function RefundsTab({
  onError,
  locale,
}: {
  onError: (e: string | null) => void;
  locale: string;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: refunds, isLoading, isError, refetch } = useRefunds(true);
  const [busy, setBusy] = useState<string | null>(null);
  const pager = useShowMore(refunds, 25);

  const post = (id: string, json: Record<string, string>) =>
    api(`/api/v1/admin/refunds/${id}/process`, { method: "POST", json });

  const process = async (id: string, decision: "approve" | "reject") => {
    if (
      decision === "reject" &&
      !(await confirmDialog({ t, body: t.refundRejectConfirm, confirmLabel: t.reject,
                              cancelLabel: t.cancel, danger: true }))
    ) return;
    setBusy(id);
    onError(null);
    try {
      try {
        await post(id, { decision });
      } catch (e) {
        // No verified provider adapter: the backend needs the reference of the
        // refund staff executed in the provider console — never invent one.
        if (!(e instanceof ApiError && e.code === "provider_ref_required")) throw e;
        const ref = await reasonDialog({ t, body: t.refundProviderRefPrompt,
                                         confirmLabel: t.approve, cancelLabel: t.cancel });
        if (!ref) return;
        await post(id, { decision, provider_ref: ref });
      }
      qc.invalidateQueries({ queryKey: ["staff"] });
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t.error);
    } finally {
      setBusy(null);
    }
  };

  const pending = (state: string) => state === "refund_requested" || state === "admin_review";

  return (
    <section>
      {isLoading && <div className="skeleton skeleton-card" />}
      {isError && <QueryError onRetry={() => refetch()} />}
      {refunds && refunds.length > 0 && (
        <p className="muted-2 mb-10">
          {t.countLabel}: {refunds.length}
        </p>
      )}
      {refunds?.length === 0 && <p className="callout"><IconCheck size={16} /> {t.noRefunds}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.campaign}</th>
              <th>{t.forBusiness}</th>
              <th>{t.total}</th>
              <th>{t.reason}</th>
              <th>{t.status}</th>
              <th>{t.payDate}</th>
            </tr>
          </thead>
          <tbody>
            {pager.visible.map((r) => (
              <tr key={r.id}>
                <td>{r.campaign_headline}</td>
                <td>{r.business_name}</td>
                <td>{formatMinor(r.amount, "UZS", locale as "ru" | "uz")}</td>
                <td className="muted-2">{r.reason}</td>
                <td>
                  <RefundStateChip state={r.state} />
                </td>
                <td>
                  {pending(r.state) && (
                    <div className="row">
                      <button
                        className="btn primary small"
                        disabled={busy === r.id}
                        onClick={() => process(r.id, "approve")}
                      >
                        <IconCheck size={12} /> {t.approve}
                      </button>
                      <button
                        className="btn danger small"
                        disabled={busy === r.id}
                        onClick={() => process(r.id, "reject")}
                      >
                        <IconReject size={12} /> {t.reject}
                      </button>
                    </div>
                  )}
                  {!pending(r.state) &&
                    formatDateTime(r.completed_at ?? r.created_at, locale as "ru" | "uz")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MoreRow hidden={pager.hidden} onMore={pager.showMore} />
    </section>
  );
}
