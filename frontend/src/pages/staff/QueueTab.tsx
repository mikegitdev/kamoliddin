import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api/client";
import { useReviewQueue } from "@/shared/api/queries";
import { confirmDialog } from "@/shared/dialog";
import { formatDateTime } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { FallImg, QueryError } from "@/shared/ui";
import {
  IconCheck,
  IconClock,
  IconExternal,
  IconPin,
  IconReject,
} from "@/shared/icons";

export function QueueTab({
  onError,
  locale,
}: {
  onError: (e: string | null) => void;
  locale: string;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: queue, isLoading, isError, refetch } = useReviewQueue(true);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const presets = [t.rejProhibited, t.rejMisleading, t.rejQuality, t.rejContacts];

  const review = async (id: string, decision: "approve" | "reject", headline?: string) => {
    // One accidental click publishes an ad city-wide — confirm, always.
    if (decision === "approve") {
      const ok = await confirmDialog({
        t,
        body: headline ? `«${headline}» — ${t.confirmApproveAd}` : t.confirmApproveAd,
        confirmLabel: t.approve,
        cancelLabel: t.cancel,
      });
      if (!ok) return;
    }
    setBusy(true);
    onError(null);
    try {
      await api(`/api/v1/admin/campaigns/${id}/review`, {
        method: "POST",
        json: { decision, reason: decision === "reject" ? reason : "" },
      });
      setRejecting(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["staff", "review-queue"] });
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
      {queue?.length === 0 && <p className="callout"><IconCheck size={16} /> {t.queueEmpty}</p>}
      {queue && queue.length > 0 && (
        <p className="muted-2 mb-10">
          {t.countLabel}: {queue.length}
        </p>
      )}
      <div className="review-list">
        {queue?.map((c) => (
          <article key={c.id} className="review-card">
            <FallImg className="review-banner" src={c.banner_url || undefined} alt="" />
            <div className="review-body">
              <div className="row-between">
                <strong>{c.headline}</strong>
                <span className="chip orange">v{c.review_version}</span>
              </div>
              <p className="muted-2 pre-wrap">{c.body}</p>
              <div className="muted-2">
                {c.business_name} · {c.owner_phone}
              </div>
              <div className="muted-2">
                <IconPin size={12} /> {c.locations.length ? c.locations.join(", ") : t.noLocations}
              </div>
              <div className="muted-2">
                <IconClock size={12} /> {formatDateTime(c.updated_at, locale as "ru" | "uz")}
              </div>
              {rejecting === c.id ? (
                <div className="stack reject-box">
                  <strong className="muted-2">{t.rejectPresetsLabel}:</strong>
                  <div className="report-presets" role="group" aria-label={t.rejectPresetsLabel}>
                    {presets.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`filter-chip${reason === p ? " active" : ""}`}
                        aria-pressed={reason === p}
                        onClick={() => setReason(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <input
                    placeholder={t.reason}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    autoFocus
                    aria-label={t.reason}
                  />
                  <div className="row">
                    <button
                      className="btn danger small"
                      disabled={busy || !reason.trim()}
                      onClick={() => review(c.id, "reject")}
                    >
                      {t.reject}
                    </button>
                    <button
                      className="btn small"
                      onClick={() => {
                        setRejecting(null);
                        setReason("");
                      }}
                    >
                      {t.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="row">
                  <button
                    className="btn primary small"
                    disabled={busy}
                    onClick={() => review(c.id, "approve", c.headline)}
                  >
                    <IconCheck size={12} /> {t.approve}
                  </button>
                  <button
                    className="btn danger small"
                    disabled={busy}
                    onClick={() => setRejecting(c.id)}
                  >
                    <IconReject size={12} /> {t.reject}
                  </button>
                  {c.banner_url && (
                    <a className="btn subtle small" href={c.banner_url} target="_blank" rel="noreferrer">
                      <IconExternal size={12} /> {t.openEntity}
                    </a>
                  )}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
