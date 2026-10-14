import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api/client";
import { useAdminCampaigns } from "@/shared/api/queries";
import { confirmDialog } from "@/shared/dialog";
import { formatDateTime } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { CampaignChip } from "@/shared/ui";
import type { CampaignStatus } from "@/entities/types";
import { IconBlock, IconCheck } from "@/shared/icons";
import { MoreRow, useShowMore } from "./pager";

const PAGE_SIZE = 25;

export function CampaignsTab({
  onError,
  locale,
}: {
  onError: (e: string | null) => void;
  locale: string;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [qInput, setQInput] = useState("");
  // Debounced query text — no request per keystroke.
  const [q, setQ] = useState("");
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => setQ(qInput.trim()), 350);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [qInput]);
  const [status, setStatus] = useState("");
  const [suspending, setSuspending] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: campaigns, isLoading } = useAdminCampaigns(true, q, status);
  const lang = locale as "ru" | "uz";

  // New query / filter ⇒ start from the first page again.
  const pager = useShowMore(campaigns, PAGE_SIZE);
  useEffect(() => {
    pager.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status]);

  const act = async (id: string, action: "suspend" | "unsuspend") => {
    // Both directions change live publication — confirm both, consistently.
    const ok = await confirmDialog({
      t,
      body: action === "suspend" ? t.confirmSuspend : t.confirmUnsuspend,
      confirmLabel: action === "suspend" ? t.suspend : t.unsuspend,
      cancelLabel: t.cancel,
      danger: action === "suspend",
    });
    if (!ok) return;
    setBusy(true);
    onError(null);
    try {
      await api(`/api/v1/admin/campaigns/${id}/${action}`, {
        method: "POST",
        json: { reason: reason || "staff action" },
      });
      setSuspending(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["staff", "campaigns"] });
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="row mb-14">
        <input
          placeholder={`${t.search}…`}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          className="max-w-280"
          aria-label={t.search}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t.status}
        >
          <option value="">{t.statusAll}</option>
          <option value="approved">{t.stApproved}</option>
          <option value="suspended">{t.stSuspended}</option>
          <option value="submitted">{t.stSubmitted}</option>
          <option value="under_review">{t.stUnderReview}</option>
          <option value="rejected">{t.stRejected}</option>
          <option value="draft">{t.stDraft}</option>
        </select>
      </div>
      {isLoading && <div className="skeleton skeleton-card" />}
      {campaigns && (
        <p className="muted-2 mb-10">
          {t.countLabel}: {campaigns.length}
        </p>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.campaign}</th>
              <th>{t.forBusiness}</th>
              <th>{t.status}</th>
              <th>{t.secSchedule}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pager.visible.map((c) => (
              <tr key={c.id}>
                <td className="max-w-240 wrap-anywhere">
                  <strong>{c.headline}</strong>
                </td>
                <td className="muted-2">
                  {c.business_name}
                  <div>{c.owner_phone}</div>
                </td>
                <td>
                  <CampaignChip status={c.review_status as CampaignStatus} />
                </td>
                <td className="muted-2">{formatDateTime(c.updated_at, lang)}</td>
                <td>
                  {c.review_status === "approved" &&
                    (suspending === c.id ? (
                      <div className="stack">
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
                            disabled={busy}
                            onClick={() => act(c.id, "suspend")}
                          >
                            <IconBlock size={12} /> {t.suspend}
                          </button>
                          <button
                            className="btn small"
                            onClick={() => setSuspending(null)}
                          >
                            {t.cancel}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="btn danger small"
                        onClick={() => setSuspending(c.id)}
                      >
                        <IconBlock size={12} /> {t.suspend}
                      </button>
                    ))}
                  {c.review_status === "suspended" && (
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() => act(c.id, "unsuspend")}
                    >
                      <IconCheck size={12} /> {t.unsuspend}
                    </button>
                  )}
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
