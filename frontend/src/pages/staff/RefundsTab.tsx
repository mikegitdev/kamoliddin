import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api/client";
import { useRefunds } from "@/shared/api/queries";
import { formatDateTime, formatMinor } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { RefundStateChip } from "@/shared/ui";
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
  const { data: refunds, isLoading } = useRefunds(true);
  const [busy, setBusy] = useState<string | null>(null);
  const pager = useShowMore(refunds, 25);

  const process = async (id: string, decision: "approve" | "reject") => {
    setBusy(id);
    onError(null);
    try {
      await api(`/api/v1/admin/refunds/${id}/process`, {
        method: "POST",
        json: { decision, provider_ref: "manual-transfer" },
      });
      qc.invalidateQueries({ queryKey: ["staff", "refunds"] });
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t.error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      {isLoading && <div className="skeleton skeleton-card" />}
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
              <th />
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
                  {r.state === "requested" && (
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
                  {r.state !== "requested" &&
                    formatDateTime(r.completed_at, locale as "ru" | "uz")}
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
