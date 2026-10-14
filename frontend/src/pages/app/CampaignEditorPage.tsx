import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useBusinessLocations,
  useBusinesses,
  useCampaign,
  useCampaignReviews,
  usePublicPricing,
} from "@/shared/api/queries";
import { ApiError } from "@/shared/api/client";
import {
  createCampaign,
  requestQuote,
  submitCampaign,
  updateCampaign,
  uploadMedia,
} from "@/features/advertiser/api";
import { formatDate, formatDateTime, estimateChargeDays, formatMinor, formatBytes, localInputToIso } from "@/shared/format";
import { confirmDialog } from "@/shared/dialog";
import { BannerEditor } from "@/shared/banner-editor";
import { toast } from "@/shared/toast";
import { useDirtyRouteGuard } from "@/shared/route-guard";
import {
  Baseline,
  Draft,
  clearDraft,
  draftKeyFor,
  readDraft,
} from "@/features/advertiser/campaignDraft";
import {
  IconAlert,
  IconArrowLeft,
  IconArrowRight,
  IconEye,
  IconLock,
  IconPencil,
  IconSave,
} from "@/shared/icons";
import { useI18n } from "@/shared/i18n";
import { CampaignChip, FallImg } from "@/shared/ui";
import type { ApiCampaign } from "@/entities/types";

/* ------------------------------------------------------------------ *
 * Staged campaign editor (spec §7.1 workflow):
 *   1. content      — headline, text, banner
 *   2. placement    — branches, schedule, auto-renew (used at quote time)
 *   3. preview      — full ad as reviewers/public will see it, then submit
 *
 * Saved-vs-editing contract:
 *   - `saved`   is the server state (what moderators see right now)
 *   - form state is the working copy; `dirty` is DERIVED against a baseline
 *     snapshot, so no edit can go untracked
 *   - unsaved edits persist to localStorage and are offered for recovery on
 *     reopen; submit always saves first, so what you previewed is exactly
 *     what gets reviewed.
 * ------------------------------------------------------------------ */

const PLACEHOLDER_BANNER = "banners/placeholder.jpg";

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultDates(): { start: string; end: string } {
  const now = new Date();
  return {
    start: toLocalInput(new Date(now.getTime() + 60 * 60 * 1000)),
    end: toLocalInput(new Date(now.getTime() + 25 * 60 * 60 * 1000)),
  };
}

/** `start` + N days, as a datetime-local string (duration presets). */
function addDays(localInput: string, days: number): string {
  const d = new Date(localInput);
  d.setDate(d.getDate() + days);
  return toLocalInput(d);
}

const CONTENT_STEPS = 3;
const LOCKED_STATUSES = ["submitted", "under_review", "suspended"];

export function CampaignEditorPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { id: editId } = useParams<{ id: string }>();
  const { data: businesses, isLoading: businessesLoading } = useBusinesses();
  const business = businesses?.[0];
  const { data: locations } = useBusinessLocations(business?.id);
  const { data: editing, isLoading: editingLoading } = useCampaign(editId);

  const dates = useMemo(defaultDates, []);
  const [stage, setStage] = useState(0);
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [bannerKey, setBannerKey] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [editingBanner, setEditingBanner] = useState(false);
  const [start, setStart] = useState(dates.start);
  const [end, setEnd] = useState(dates.end);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [autoRenew, setAutoRenew] = useState(false); // default OFF (spec §8 [C])
  const [saved, setSaved] = useState<ApiCampaign | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [cardPreview, setCardPreview] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const headlineRef = useRef<HTMLInputElement>(null);
  const initedRef = useRef<string | null>(null); // editor session guard per draft key

  const applyError = (e: unknown) => {
    if (e instanceof ApiError) {
      toast.error(e.message);
      const flat: Record<string, string> = {};
      for (const [key, messages] of Object.entries(e.fields ?? {})) {
        flat[key] = messages.join(" ");
      }
      setFieldErrors(flat);
    } else {
      toast.error(t.error);
    }
  };

  // ---------- init: server prefill + unsaved-edit recovery ----------
  useEffect(() => {
    if (!editing || !business) return;
    const key = `campaign-draft:${editing.id}`;
    if (initedRef.current === key) return;
    initedRef.current = key;

    const draft = readDraft(key);
    if (draft && draft.baseUpdatedAt === editing.updated_at) {
      // Edits on top of the very version the server still has: recover them.
      setHeadline(draft.headline);
      setBody(draft.body);
      setBannerKey(draft.bannerKey);
      setBannerUrl(draft.bannerUrl);
      setStart(draft.start);
      setEnd(draft.end);
      setSelected(new Set(draft.selected));
      setAutoRenew(draft.autoRenew);
      setStage(Math.min(draft.stage, CONTENT_STEPS - 1));
      setRestoredAt(draft.savedAt);
    } else {
      if (draft) clearDraft(key); // server moved on — the draft was superseded
      setHeadline(editing.headline);
      setBody(editing.body);
      setBannerKey(editing.banner_key);
      setBannerUrl(editing.banner_url);
    }
    setSaved(editing);
    // Baseline is ALWAYS the server content: restored drafts are unsaved
    // edits on top of it (dirty), and "discard" returns to exactly this.
    setBaseline({
      headline: editing.headline,
      body: editing.body,
      bannerKey: editing.banner_key,
      start: dates.start,
      end: dates.end,
      selected: [],
      autoRenew: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, business]);

  // New-campaign session: offer recovery for the business's unsaved draft.
  useEffect(() => {
    if (editId || !business) return;
    const key = `campaign-draft:new:${business.id}`;
    if (initedRef.current === key) return;
    initedRef.current = key;

    const draft = readDraft(key);
    if (draft) {
      setHeadline(draft.headline);
      setBody(draft.body);
      setBannerKey(draft.bannerKey);
      setBannerUrl(draft.bannerUrl);
      setStart(draft.start);
      setEnd(draft.end);
      setSelected(new Set(draft.selected));
      setAutoRenew(draft.autoRenew);
      setStage(Math.min(draft.stage, CONTENT_STEPS - 1));
      setRestoredAt(draft.savedAt);
    }
    setBaseline({
      headline: draft?.headline ?? "",
      body: draft?.body ?? "",
      bannerKey: draft?.bannerKey ?? "",
      start: draft?.start ?? dates.start,
      end: draft?.end ?? dates.end,
      selected: draft?.selected ?? [],
      autoRenew: draft?.autoRenew ?? false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business, editId]);

  // ---------- derived state ----------
  const dirty = useMemo(() => {
    if (!baseline) return false;
    if (headline !== baseline.headline || body !== baseline.body || bannerKey !== baseline.bannerKey)
      return true;
    if (start !== baseline.start || end !== baseline.end || autoRenew !== baseline.autoRenew)
      return true;
    if (selected.size !== baseline.selected.length) return true;
    for (const id of selected) if (!baseline.selected.includes(id)) return true;
    return false;
  }, [baseline, headline, body, bannerKey, start, end, autoRenew, selected]);

  // Confirm (once) when leaving with unsaved edits — covers nav tabs and the
  // back button alike; intentional flows call bypassNextNav() first.
  const { bypassNextNav } = useDirtyRouteGuard(dirty);

  const locked = !!saved && LOCKED_STATUSES.includes(saved.review_status);
  const rejected = saved?.review_status === "rejected";
  const approved = saved?.review_status === "approved";
  const isRevision = !!editId;

  const draftKey = draftKeyFor(saved?.id ?? editId, business?.id ?? "");

  // Persist unsaved edits for recovery (kept until saved or discarded).
  useEffect(() => {
    if (!baseline || !dirty || locked || !business) return;
    const draft: Draft = {
      headline,
      body,
      bannerKey,
      bannerUrl,
      start,
      end,
      selected: [...selected],
      autoRenew,
      stage,
      baseUpdatedAt: saved?.updated_at ?? null,
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      /* storage full/unavailable — editing still works, recovery just won't */
    }
  }, [baseline, dirty, locked, business, headline, body, bannerKey, bannerUrl,
      start, end, selected, autoRenew, stage, draftKey, saved]);

  // Warn on browser close/refresh with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ---------- mutations ----------
  const contentPayload = () => ({
    business: business!.id,
    headline,
    body,
    banner_key: bannerKey || PLACEHOLDER_BANNER,
  });

  const settleSaved = (campaign: ApiCampaign) => {
    // Draft keys from both the pre-save and post-save identity are obsolete now.
    if (business) clearDraft(`campaign-draft:new:${business.id}`);
    clearDraft(`campaign-draft:${campaign.id}`);
    setSaved(campaign);
    setBaseline({
      headline: campaign.headline,
      body: campaign.body,
      bannerKey: campaign.banner_key,
      start, end, selected: [...selected], autoRenew,
    });
    setRestoredAt(null);
    qc.invalidateQueries({ queryKey: ["campaigns"] });
    qc.invalidateQueries({ queryKey: ["campaign", campaign.id] });
  };

  const saveDraft = useMutation({
    mutationFn: async (): Promise<ApiCampaign> =>
      saved ? updateCampaign(saved.id, contentPayload()) : createCampaign(contentPayload()),
    onSuccess: (campaign) => {
      settleSaved(campaign);
      toast.success(t.campaignSaved);
      setFieldErrors({});
    },
    onError: applyError,
  });

  // Submit always saves first: reviewers see exactly the previewed content.
  const submit = useMutation({
    mutationFn: async (): Promise<ApiCampaign> => {
      let current = saved;
      if (dirty) {
        current = current
          ? await updateCampaign(current.id, contentPayload())
          : await createCampaign(contentPayload());
      }
      return submitCampaign(current!.id);
    },
    onSuccess: (campaign) => {
      settleSaved(campaign);
      qc.invalidateQueries({ queryKey: ["campaign-reviews", campaign.id] });
      bypassNextNav();
      navigate(`/app/campaigns/${campaign.id}`);
    },
    onError: applyError,
  });

  const quote = useMutation({
    mutationFn: () =>
      requestQuote({
        business_id: business!.id,
        campaign_id: saved!.id,
        location_ids: [...selected],
        requested_start_at: localInputToIso(start),
        requested_end_at: localInputToIso(end),
        auto_renew: autoRenew,
      }),
    onSuccess: (order) => {
      bypassNextNav();
      navigate(`/app/checkout/${order.id}`);
    },
    onError: applyError,
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadMedia(file, "banners"),
    onSuccess: (res) => {
      setBannerKey(res.key);
      setBannerUrl(res.url);
    },
    onError: applyError,
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ---------- guards & gating ----------
  const leaveEditor = () => {
    // The dirty-route guard intercepts this navigation and confirms when
    // there are unsaved edits (same protection as the nav tabs).
    navigate("/app/campaigns");
  };

  const discardRestored = () => {
    if (!baseline) return;
    setHeadline(baseline.headline);
    setBody(baseline.body);
    setBannerKey(baseline.bannerKey);
    setBannerUrl(saved?.banner_url ?? "");
    setStart(baseline.start);
    setEnd(baseline.end);
    setSelected(new Set(baseline.selected));
    setAutoRenew(baseline.autoRenew);
    clearDraft(draftKey);
    setRestoredAt(null);
  };

  const { data: reviews } = useCampaignReviews(rejected ? saved?.id : undefined);
  const latestRejection = reviews?.find((r) => r.decision === "rejected");

  // ---------- stage gating & live estimate ----------
  const headlineOk = headline.trim().length > 2;
  const scheduleOk = new Date(end).getTime() > new Date(start).getTime();
  // Schedule fields live on stage 2 — stage 1 only gates on the headline.
  const stage1Hint = !headlineOk ? t.nextRequiresHeadline : null;
  const stageReachable = (i: number) =>
    i === 0 || (i === 1 && headlineOk) || (i === 2 && headlineOk && scheduleOk);

  const { data: pricing } = usePublicPricing();
  const tariff = pricing?.tariff ?? null;
  const estimateDays = estimateChargeDays(start, end);
  const estimate =
    tariff && selected.size > 0 && estimateDays > 0
      ? { total: tariff.amount_per_24h * selected.size * estimateDays, currency: tariff.currency }
      : null;

  // ---------- render ----------
  if (!business) {
    // Loading and "no business yet" are different states: an existing
    // advertiser must not be told to create a business while data loads.
    if (businessesLoading) {
      return (
        <section>
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card mt-10 h160" />
        </section>
      );
    }
    return (
      <section>
        <div className="setup-next">
          <div>
            <strong>{t.setupStep1}</strong>
            <div className="muted-2">{t.createBusinessHint}</div>
          </div>
          <Link className="btn primary" to="/app/business">
            {t.createBusiness}
          </Link>
        </div>
      </section>
    );
  }

  if (editId && editingLoading) {
    return (
      <section>
        <div className="skeleton skeleton-card" />
      </section>
    );
  }
  if (editId && !editing) {
    return (
      <section>
        <p className="callout">{t.notFound}</p>
        <Link className="btn" to="/app/campaigns"><IconArrowLeft size={14} /> {t.backToCampaigns}</Link>
      </section>
    );
  }

  const canSubmit =
    !locked && !approved && headline.trim().length > 2 && !!bannerKey &&
    (!saved || ["draft", "rejected"].includes(saved.review_status));
  // An APPROVED campaign stays editable: saving content bumps review_version
  // and returns it to moderation (backend CampaignSerializer) — the confirm
  // dialog makes the "ads go dark until re-approval" consequence explicit.
  const canSave =
    !locked && headline.trim().length > 2 &&
    (!saved || ["draft", "rejected", "approved"].includes(saved.review_status));
  // NOTE: a DRAFT deliberately does not require a banner — only submit and
  // quote do (design system §7.7). The backend accepts banner-less drafts
  // (the seeded e2e drafts exist without one); gating save on the banner
  // made "Сохранить черновик" a dead-end disabled button.
  const canQuote =
    !!saved &&
    ["submitted", "under_review", "approved"].includes(saved.review_status) &&
    selected.size > 0 &&
    !!bannerKey;

  const stages = [t.stepContent, t.stepPlacement, t.stepPreview];

  // Editing APPROVED content re-enters moderation (spec §7.1 [R]) and takes
  // every live placement of this campaign off the public map until
  // re-approval; auto-renewal pauses as well (content hash mismatch, §8).
  // The user must confirm that consciously — no silent going-dark.
  const confirmApprovedEdit = async (): Promise<boolean> => {
    if (saved?.review_status !== "approved") return true;
    return confirmDialog({
      t,
      title: t.confirmTitle,
      body: t.editorApprovedEditWarning,
      confirmLabel: t.save,
      cancelLabel: t.cancel,
      danger: true,
    });
  };

  const saveButton = locked ? null : (
    <button
      className="btn"
      disabled={!canSave || saveDraft.isPending}
      onClick={() => {
        void confirmApprovedEdit().then((ok) => ok && saveDraft.mutate());
      }}
    >
      {saveDraft.isPending ? t.saving : t.saveDraft}
    </button>
  );

  return (
    <section className="form">
      <div className="row-between">
        <h2>{isRevision ? t.editCampaign : t.newCampaign}</h2>
        <button className="btn small" onClick={leaveEditor}>
          <IconArrowLeft size={14} /> {t.backToCampaigns}
        </button>
      </div>

      {/* what is saved vs what I'm editing */}
      <div className="editor-status">
        {saved && <CampaignChip status={saved.review_status} />}
        {saved && <span className="save-state">{t.versionLabel} {saved.review_version}</span>}
        {baseline && (
          <span className={`save-state ${dirty ? "dirty" : saved ? "saved" : ""}`}>
            {dirty ? t.unsavedChanges : saved ? t.savedLabel : ""}
          </span>
        )}
      </div>

      {locked && (
        <p className="callout danger" role="alert">
          <IconLock size={14} /> {t.lockedNotice}
        </p>
      )}

      {rejected && (
        <div className="rejection-card" role="alert">
          <strong>
            <IconAlert size={14} /> {t.rejectionTitle}
            {latestRejection && ` · v${latestRejection.content_version} · ${formatDateTime(latestRejection.created_at, locale)}`}
          </strong>
          <div>
            <span className="muted">{t.rejectionReasonLabel}: </span>
          </div>
          <div className="rejection-reason">
            {reviews
              ? latestRejection?.reason || t.rejectionNoReason
              : t.loading}
          </div>
          <span className="muted-2">{t.rejectionHint}</span>
          <div className="row">
            <button
              className="btn primary small"
              onClick={() => {
                setStage(0);
                headlineRef.current?.focus();
              }}
            >
              {t.rejectionFixBtn}
            </button>
          </div>
        </div>
      )}

      {restoredAt !== null && (
        <div className="callout" role="status">
          <span>
            <IconSave size={14} /> {t.restoredEdits} · {formatDateTime(new Date(restoredAt).toISOString(), locale)}
          </span>
          <div className="row mt-8">
            <button className="btn small primary" onClick={() => setRestoredAt(null)}>
              {t.keepEditsBtn}
            </button>
            <button className="btn small" onClick={discardRestored}>
              {t.discardEditsBtn}
            </button>
          </div>
        </div>
      )}

      {/* stage stepper — forward jumps are gated on stage validity */}
      <div className="status-filter" role="group" aria-label={t.newCampaign}>
        {stages.map((label, i) => (
          <button
            key={label}
            className="filter-chip"
            aria-current={stage === i ? "step" : undefined}
            disabled={stage !== i && !stageReachable(i)}
            onClick={() => setStage(i)}
          >
            {i + 1}. {label}
          </button>
        ))}
      </div>

      {/* ---------------- stage 1: content ---------------- */}
      {stage === 0 && (
        <fieldset className="form-section flush" disabled={locked}>
          <h3 className="section-title">
            {t.secContent}
          </h3>

          <div className="field">
            <label htmlFor="ce-headline">{t.headline}</label>
            <input
              id="ce-headline"
              ref={headlineRef}
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              maxLength={200}
              aria-describedby={fieldErrors.headline ? "ce-headline-err" : undefined}
            />
            <span className="field-hint field-counter" aria-hidden="true">
              {headline.length}/200
            </span>
            {fieldErrors.headline && (
              <span className="field-error" id="ce-headline-err" role="alert">
                {fieldErrors.headline}
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="ce-body">{t.adText}</label>
            <textarea
              id="ce-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
            />
          </div>

          <div className="field">
            <label htmlFor="ce-banner">{t.banner}</label>
            <span className="field-hint" id="ce-banner-hint">
              {t.bannerFormats}
            </span>
            <div
              className={`drop-zone${dragOver ? " over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file && file.type.startsWith("image/")) {
                  setRawFile(file);
                  setEditingBanner(true);
                }
              }}
            >
              <input
                id="ce-banner"
                className="file-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-describedby="ce-banner-hint"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && file.type.startsWith("image/")) {
                    setRawFile(file);
                    setEditingBanner(true);
                  }
                  e.target.value = "";
                }}
              />
              {rawFile && (
                <span className="drop-zone-meta muted-2">
                  {rawFile.name} · {formatBytes(rawFile.size, locale)}
                </span>
              )}
            </div>
            {bannerUrl && <img className="banner-preview" src={bannerUrl} alt="" />}
            {rawFile && !editingBanner && (
              <button
                type="button"
                className="btn small"
                onClick={() => setEditingBanner(true)}
              >
                <IconPencil size={12} /> {t.beEditAgain}
              </button>
            )}
            {rawFile && editingBanner && (
              <BannerEditor
                file={rawFile}
                onApply={(edited) => {
                  setEditingBanner(false);
                  upload.mutate(edited);
                }}
                onClose={() => setEditingBanner(false)}
              />
            )}
            {upload.isPending && (
              <p className="muted-2 uploading-row">
                <span className="spinner" aria-hidden="true" /> {t.loading}
              </p>
            )}
            {fieldErrors.banner_key && (
              <span className="field-error" role="alert">
                {fieldErrors.banner_key}
              </span>
            )}
          </div>

          <div className="stage-actions">
            <span />
            <div className="row">
              {saveButton}
              <button
                className="btn primary"
                disabled={!headlineOk}
                onClick={() => setStage(1)}
              >
                {t.next} <IconArrowRight size={14} />
              </button>
            </div>
          </div>
          {stage1Hint && (
            <p className="field-hint stage-hint">
              <IconAlert size={12} /> {stage1Hint}
            </p>
          )}
        </fieldset>
      )}

      {/* ---------------- stage 2: placement ---------------- */}
      {stage === 1 && (
        <fieldset className="form-section flush" disabled={locked}>
          <h3 className="section-title">
            {t.secBranches}
            {selected.size > 0 && (
              <span className="chip blue">
                {t.branchesSelected}: {selected.size}
              </span>
            )}
          </h3>
          <p className="field-hint mb-10">{t.placementHint}</p>
          {locations && locations.length === 0 && (
            <p className="callout">
              {t.noBranches} — <Link to="/app/locations">{t.addBranch}</Link>
            </p>
          )}
          <ul className="check-list">
            {locations?.map((loc) => (
              <li key={loc.id}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={selected.has(loc.id)}
                    onChange={() => toggle(loc.id)}
                  />
                  {loc.name} <span className="muted">· {loc.address}</span>
                </label>
              </li>
            ))}
          </ul>

          <h3 className="section-title mt-18">
            {t.secSchedule}
          </h3>
          <div className="two-cols">
            <div className="field">
              <label htmlFor="ce-start">{t.startDate}</label>
              <input
                id="ce-start"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="ce-end">{t.endDate}</label>
              <input
                id="ce-end"
                type="datetime-local"
                value={end}
                min={start}
                onChange={(e) => setEnd(e.target.value)}
              />
              {!scheduleOk && (
                <span className="field-error" role="alert">
                  {t.endAfterStart}
                </span>
              )}
            </div>
          </div>

          {/* Duration presets: the product sells 24h slots — offer the common
              spans as one tap instead of manual datetime math. */}
          <div className="duration-presets" role="group" aria-label={t.secSchedule}>
            {[
              { days: 1, label: t.duration24h },
              { days: 3, label: t.duration3d },
              { days: 7, label: t.duration7d },
            ].map(({ days, label }) => (
              <button
                key={days}
                type="button"
                className="btn subtle small"
                onClick={() => setEnd(addDays(start, days))}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Live cost estimate: the quote endpoint stays the source of
              truth — this keeps the money decision informed, not final. */}
          <div className="estimate-card" aria-live="polite">
            <strong>{t.estimateTitle}</strong>
            {estimate ? (
              <>
                <span className="estimate-amount">
                  {formatMinor(estimate.total, estimate.currency, locale)}
                </span>
                <span className="muted-2">
                  {selected.size} {t.estimateLocations} × {estimateDays} {t.estimateDaysLabel}{" · "}
                  {formatMinor(tariff!.amount_per_24h, tariff!.currency, locale)} {t.perDay}
                </span>
                <span className="muted-2">{t.estimateNote}</span>
              </>
            ) : selected.size === 0 ? (
              <span className="muted-2">{t.placementHint}</span>
            ) : (
              <span className="muted-2">{t.estimateNoTariff}</span>
            )}
          </div>

          <h3 className="section-title mt-18">
            {t.secRenewal}
          </h3>
          <label className="check-row">
            <input
              type="checkbox"
              checked={autoRenew}
              onChange={(e) => setAutoRenew(e.target.checked)}
            />
            {t.autoRenew}
          </label>
          <span className="field-hint">{t.autoRenewHint}</span>

          <div className="stage-actions">
            <button className="btn" onClick={() => setStage(0)}>
              <IconArrowLeft size={14} /> {t.back}
            </button>
            <div className="row">
              {saveButton}
              <button
                className="btn primary"
                disabled={!scheduleOk}
                onClick={() => setStage(2)}
              >
                {t.next} <IconArrowRight size={14} />
              </button>
            </div>
          </div>
          {!scheduleOk && (
            <p className="field-hint stage-hint">
              <IconAlert size={12} /> {t.endAfterStart}
            </p>
          )}
        </fieldset>
      )}

      {/* ---------------- stage 3: preview & submit ---------------- */}
      {stage === 2 && (
        <div className="form-section flush">
          <h3 className="section-title">
            {t.previewTitle}
          </h3>

          <div className="status-filter" role="group" aria-label={t.previewTitle}>
            <button
              className="filter-chip"
              aria-pressed={!cardPreview}
              onClick={() => setCardPreview(false)}
            >
              {t.previewTabPage}
            </button>
            <button
              className="filter-chip"
              aria-pressed={cardPreview}
              onClick={() => setCardPreview(true)}
            >
              {t.previewTabCard}
            </button>
          </div>

          {cardPreview ? (
            <div className="preview-frame">
              <div className="ad-card">
                <FallImg src={bannerUrl || undefined} alt="" />
                <div className="ad-card-body">
                  <strong>{headline}</strong>
                  <span className="muted-2">{business.name}</span>
                  {scheduleOk && (
                    <span className="muted-2">
                      {formatDate(start, locale)} → {formatDate(end, locale)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="preview-frame">
              {bannerUrl ? (
                <div className="ad-banner">
                  <img src={bannerUrl} alt="" />
                </div>
              ) : (
                <p className="muted-2"><IconAlert size={12} /> {t.bannerRequired}</p>
              )}
              <h3>{headline || t.headline}</h3>
              <span className="muted-2">{business.name}</span>
              {body && <p className="preview-body">{body}</p>}
            </div>
          )}
          <p className="preview-meta">
            <IconEye size={14} /> {t.previewReviewerNote}
            {dirty && ` · ${t.previewUnsavedNote}`}
          </p>

          {approved && dirty && (
            <p className="callout danger"><IconAlert size={14} /> {t.reReviewWarning}</p>
          )}

          {!canQuote && !locked && saved && ["draft", "rejected"].includes(saved.review_status) && (
            <p className="field-hint stage-hint">
              <IconAlert size={12} /> {t.quoteNeedsSubmit}
            </p>
          )}

          <div className="stage-actions">
            <button className="btn" onClick={() => setStage(1)}>
              <IconArrowLeft size={14} /> {t.back}
            </button>
            <div className="row">
              {saveButton}
              {canQuote && (
                <button
                  className="btn"
                  disabled={quote.isPending}
                  onClick={() => quote.mutate()}
                >
                  {quote.isPending ? t.loading : t.getQuoteAndPay}
                </button>
              )}
              {canSubmit && (
                <button
                  className="btn primary"
                  disabled={submit.isPending}
                  onClick={() => submit.mutate()}
                >
                  {submit.isPending ? t.sending : dirty ? t.saveAndSubmit : t.submitReview}
                </button>
              )}
            </div>
          </div>
          {canSubmit && !bannerKey && <p className="field-hint"><IconAlert size={12} /> {t.bannerRequired}</p>}
        </div>
      )}
    </section>
  );
}
