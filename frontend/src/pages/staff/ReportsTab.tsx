import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api/client";
import { useReports } from "@/shared/api/queries";
import { formatDateTime } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { ReportStateChip, QueryError } from "@/shared/ui";
import {
  IconCheck,
  IconClock,
  IconMegaphone,
  IconPin,
  IconScale,
} from "@/shared/icons";
import { RowMenu, useStaffLink } from "./controls";

export function ReportsTab({
  onError,
  locale,
}: {
  onError: (e: string | null) => void;
  locale: string;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: reports, isLoading, isError, refetch } = useReports(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const lang = locale as "ru" | "uz";
  const link = useStaffLink();
  // Same labels the visitor picked from (see shared/dialog.tsx ReportBody).
  const reasonLabel: Record<string, string> = {
    spam: t.reportReasonSpam,
    offensive: t.reportReasonOffensive,
    prohibited: t.reportReasonProhibited,
    outdated: t.reportReasonOutdated,
    other: t.reportReasonOther,
  };

  const process = async (id: string, decision: "resolve" | "dismiss") => {
    setBusy(true);
    onError(null);
    try {
      await api(`/api/v1/admin/reports/${id}/process`, {
        method: "POST",
        json: { decision, note },
      });
      setProcessing(null);
      setNote("");
      qc.invalidateQueries({ queryKey: ["staff"] }); // list + nav badge counters
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      {isLoading && <div className="skeleton skeleton-card" />}
      {isError && <QueryError onRetry={() => refetch()} />}
      {reports && reports.length > 0 && (
        <p className="muted-2 mb-10">
          {t.countLabel}: {reports.length}
        </p>
      )}
      {reports?.length === 0 && <p className="callout"><IconCheck size={16} /> {t.noReports}</p>}
      <div className="review-list">
        {reports?.map((r) => (
          <article key={r.id} className="review-card">
            <div className="review-body">
              <div className="row-between">
                <strong>
                  {r.entity === "campaign" ? <IconMegaphone size={16} /> : <IconPin size={16} />}{" "}
                  {r.entity === "campaign" ? t.campaign : t.branch} · …{r.entity_id.slice(0, 8)}
                </strong>
                <ReportStateChip state={r.state} />
              </div>
              <p className="muted-2">
                <strong>{reasonLabel[r.category] ?? t.reportReasonOther}</strong>
                {r.reason && ` · ${r.reason}`}
              </p>
              <div className="muted-2"><IconClock size={12} /> {formatDateTime(r.created_at, lang)}</div>
              {r.state !== "open" && (
                <div className="muted-2">
                  {r.resolved_by_phone} · {formatDateTime(r.resolved_at, lang)}
                  {r.resolution_note && ` · ${r.resolution_note}`}
                </div>
              )}
              {r.state === "open" &&
                (processing === r.id ? (
                  <div className="stack">
                    <input
                      className="report-note"
                      placeholder={t.note}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      autoFocus
                      aria-label={t.note}
                    />
                    <div className="row">
                      <button
                        className="btn primary small"
                        disabled={busy}
                        onClick={() => process(r.id, "resolve")}
                      >
                        <IconCheck size={12} /> {t.resolve}
                      </button>
                      <button
                        className="btn small"
                        disabled={busy}
                        onClick={() => process(r.id, "dismiss")}
                      >
                        {t.dismiss}
                      </button>
                      <button
                        className="btn small"
                        onClick={() => {
                          setProcessing(null);
                          setNote("");
                        }}
                      >
                        {t.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="row">
                    <button
                      className="btn small"
                      onClick={() => setProcessing(r.id)}
                    >
                      <IconScale size={12} /> {t.process}
                    </button>
                    <RowMenu
                      items={[
                        {
                          label: t.viewPlacements,
                          onClick: () =>
                            link.go("placements", r.entity === "campaign"
                              ? { campaign: r.entity_id }
                              : { location: r.entity_id }),
                        },
                        {
                          label: t.viewLog,
                          onClick: () => link.go("logs", { entity: r.entity, entity_id: r.entity_id }),
                        },
                        {
                          label: t.openEntity,
                          to: r.entity === "campaign" ? `/ads/${r.entity_id}` : `/locations/${r.entity_id}`,
                        },
                      ]}
                    />
                  </div>
                ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
