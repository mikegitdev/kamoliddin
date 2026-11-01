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
import { useCurrentBusiness } from "@/features/advertiser/currentBusiness";
import { ApiError } from "@/shared/api/client";
import {
  createCampaign,
  requestQuote,
  submitCampaign,
  updateCampaign,
  uploadMedia,
} from "@/features/advertiser/api";
import {
  formatDate,
  formatDateTime,
  estimateChargeDays,
  formatMinor,
  formatBytes,
  localInputToIso,
  tashkentInputMs,
  toTashkentInput,
} from "@/shared/format";
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
  IconCheck,
  IconEye,
  IconLock,
  IconPencil,
  IconPlus,
  IconSave,
} from "@/shared/icons";
import { plural, useI18n } from "@/shared/i18n";
import { CampaignChip, FallImg, QueryError } from "@/shared/ui";

import type { ApiCampaign } from "@/entities/types";

/* ------------------------------------------------------------------ *
 * Staged campaign editor (spec §7.1 workflow):
 *   1. content      — headline, text, banner
 *   2. placement    — branches, schedule (used at quote time)
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

/** Files whose extension the browser/OS can't map get `type: ""` (chat-app
 *  downloads, .jfif, broken registry mappings) and were silently dropped.
 *  Accept by type OR known extension; the editor's decode and the backend's
 *  magic-byte check remain the real gatekeepers for actual content. */
const BANNER_NAME_RE = /\.(jpe?g|png|webp)$/i;
const looksLikeBanner = (file: File) =>
  file.type.startsWith("image/") || BANNER_NAME_RE.test(file.name);

// Schedule inputs are Tashkent wall time (shared/format), like every date shown.
function defaultDates(): { start: string; end: string } {
  const now = new Date();
  return {
    start: toTashkentInput(new Date(now.getTime() + 60 * 60 * 1000)),
    end: toTashkentInput(new Date(now.getTime() + 25 * 60 * 60 * 1000)),
  };
}

/** `start` + N days, as a datetime-local string (duration presets). */
function addDays(localInput: string, days: number): string {
  const ms = tashkentInputMs(localInput);
  return Number.isFinite(ms) ? toTashkentInput(new Date(ms + days * 86_400_000)) : localInput;
}

// One-time purchase spans offered as one tap (days of 24h slots).
const DURATION_PRESETS = [1, 3, 7, 14, 30, 60, 90] as const;

/** Start presets in Tashkent wall time: now, tomorrow 09:00, next Monday 09:00. */
function startPresets(): { now: string; tomorrow: string; nextMonday: string } {
  const now = toTashkentInput(new Date(Date.now() + 5 * 60 * 1000));
  const today = now.slice(0, 10);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return {
    now,
    tomorrow: addDays(`${today}T09:00`, 1),
    nextMonday: addDays(`${today}T09:00`, (8 - weekday) % 7 || 7),
  };
}

const CONTENT_STEPS = 3;
const LOCKED_STATUSES = ["submitted", "under_review", "suspended"];

export function CampaignEditorPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { id: editId } = useParams<{ id: string }>();
  const {
    data: businesses,
    isLoading: businessesLoading,
    isError: businessesFailed,
    refetch: refetchBusinesses,
  } = useBusinesses();
  const {
    data: editing,
    isLoading: editingLoading,
    isError: editingFailed,
    error: editingError,
    refetch: refetchEditing,
  } = useCampaign(editId);
  // An existing campaign belongs to its own business (its branches, its
  // quotes); a new one is created for the business picked in the header.
  const currentBusiness = useCurrentBusiness(businesses);
  const business = editing ? businesses?.find((b) => b.id === editing.business) : currentBusiness;
  const { data: locations } = useBusinessLocations(business?.id);

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
  // Paid visibility add-on (Joymee-style TOP/RAISED). Deliberately NOT part
  // of the persisted draft: it is a checkout-time money choice, reset on
  // reload, exactly like picking a tariff on Joymee's promote page.
  const [promoTier, setPromoTier] = useState<"top" | "raised" | null>(null);
  const [saved, setSaved] = useState<ApiCampaign | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [cardPreview, setCardPreview] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // "Fill the headline" must not greet a blank form — only hint after the
  // user has actually interacted with the field and left it invalid.
  const [headlineTouched, setHeadlineTouched] = useState(false);

  const headlineRef = useRef<HTMLInputElement>(null);
  const initedRef = useRef<string | null>(null); // editor session guard per draft key

  const applyError = (e: unknown) => {
    if (e instanceof ApiError) {
      toast.error(e.message);
      setFieldErrors(e.fieldMessages());
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
      setStage(Math.min(draft.stage, CONTENT_STEPS - 1));
      setRestoredAt(draft.savedAt);
    } else {
      if (draft) clearDraft(key); // server moved on — the draft was superseded
      setHeadline(editing.headline);
      setBody(editing.body);
      setBannerKey(editing.banner_key);
      setBannerUrl(editing.banner_url);
      // Content is locked under review, but placements can still be bought:
      // open straight on the placement step.
      if (["submitted", "under_review"].includes(editing.review_status)) setStage(1);
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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business, editId]);

  // ---------- derived state ----------
  const dirty = useMemo(() => {
    if (!baseline) return false;
    if (headline !== baseline.headline || body !== baseline.body || bannerKey !== baseline.bannerKey)
      return true;
    if (start !== baseline.start || end !== baseline.end) return true;
    if (selected.size !== baseline.selected.length) return true;
    for (const id of selected) if (!baseline.selected.includes(id)) return true;
    return false;
  }, [baseline, headline, body, bannerKey, start, end, selected]);

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
      start, end, selected, stage, draftKey, saved]);

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
      start, end, selected: [...selected],
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

  const quoteFor = (campaignId: string) =>
    requestQuote({
      business_id: business!.id,
      campaign_id: campaignId,
      location_ids: [...selected],
      requested_start_at: localInputToIso(start),
      requested_end_at: localInputToIso(end),
      promotion_tier: promoTier,
    });

  const goToCheckout = (order: { id: string }) => {
    bypassNextNav();
    navigate(`/app/checkout/${order.id}`);
  };

  const quote = useMutation({
    mutationFn: () => quoteFor(saved!.id),
    onSuccess: goToCheckout,
    onError: applyError,
  });

  // Pay-first flow (spec §7.2: payment and moderation are separate gates):
  // save → submit → quote → checkout in one action. A paid order on an
  // unapproved campaign keeps PENDING placements until approval; rejection
  // unlocks the refund flow. If the quote step fails after a successful
  // submit, `saved` already reflects the submitted campaign, so the user can
  // retry with "Get quote & pay" without resubmitting.
  const payAndSubmit = useMutation({
    mutationFn: async () => {
      let current = saved;
      if (dirty || !current) {
        current = current
          ? await updateCampaign(current.id, contentPayload())
          : await createCampaign(contentPayload());
      }
      if (["draft", "rejected"].includes(current.review_status)) {
        current = await submitCampaign(current.id);
      }
      settleSaved(current);
      qc.invalidateQueries({ queryKey: ["campaign-reviews", current.id] });
      return quoteFor(current.id);
    },
    onSuccess: goToCheckout,
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
    clearDraft(draftKey);
    setRestoredAt(null);
  };

  const { data: reviews } = useCampaignReviews(rejected ? saved?.id : undefined);
  const latestRejection = reviews?.find((r) => r.decision === "rejected");

  // ---------- stage gating & live estimate ----------
  const headlineOk = headline.trim().length > 2;
  const scheduleOk = tashkentInputMs(end) > tashkentInputMs(start);
  const durationMs = tashkentInputMs(end) - tashkentInputMs(start);
  const presets = startPresets();
  // The quote endpoint refuses past starts (a minute of slack for "now").
  const startInPast = tashkentInputMs(start) < Date.now() - 60_000;
  // Schedule fields live on stage 2 — stage 1 only gates on the headline.
  const stage1Hint = headlineTouched && !headlineOk ? t.nextRequiresHeadline : null;
  const stageReachable = (i: number) =>
    i === 0 || (i === 1 && headlineOk) || (i === 2 && headlineOk && scheduleOk);

  const { data: pricing } = usePublicPricing();
  const tariff = pricing?.tariff ?? null;
  const estimateDays = estimateChargeDays(localInputToIso(start), localInputToIso(end));
  const promoRate =
    promoTier && tariff ? tariff[`amount_${promoTier}_per_24h`] : null;
  const estimate =
    tariff && selected.size > 0 && estimateDays > 0
      ? {
          total:
            (tariff.amount_per_24h + (promoRate ?? 0)) * selected.size * estimateDays,
          promoRate,
          currency: tariff.currency,
        }
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
    // A failed load is not "no business yet" — don't send them to create one.
    if (businessesFailed) {
      return (
        <section>
          <QueryError onRetry={() => refetchBusinesses()} />
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
    const failed =
      editingFailed && !(editingError instanceof ApiError && editingError.status === 404);
    return (
      <section>
        {failed ? (
          <QueryError onRetry={() => refetchEditing()} />
        ) : (
          <p className="callout">{t.notFound}</p>
        )}
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
    !!bannerKey &&
    !startInPast;
  const busy = submit.isPending || payAndSubmit.isPending || quote.isPending;

  const stages = [t.stepContent, t.stepPlacement, t.stepPreview];

  // Editing APPROVED content re-enters moderation (spec §7.1 [R]) and takes
  // every live placement of this campaign off the public map until
  // re-approval.
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
        {baseline && (dirty || saved) && (
          <span className={`save-state ${dirty ? "dirty" : saved ? "saved" : ""}`}>
            {dirty ? t.unsavedChanges : t.savedLabel}
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

      {/* stage stepper — forward jumps are gated on stage validity; steps
          left behind get a check so progress is visible at a glance */}
      <div className="status-filter" role="group" aria-label={t.newCampaign}>
        {stages.map((label, i) => (
          <button
            key={label}
            className={`filter-chip step-chip${stage > i ? " done" : ""}`}
            aria-current={stage === i ? "step" : undefined}
            disabled={stage !== i && !stageReachable(i)}
            onClick={() => setStage(i)}
          >
            <span className="step-num" aria-hidden="true">
              {stage > i ? <IconCheck size={11} /> : i + 1}
            </span>
            {label}
          </button>
        ))}
      </div>

      {/* ---------------- stage 1: content ---------------- */}
      {stage === 0 && (
        // No repeated section title here: the step chip right above already
        // says "Объявление" — a duplicate heading only added noise.
        <fieldset className="form-section flush" disabled={locked}>
          <div className="field">
            <label htmlFor="ce-headline">{t.headline}</label>
            <input
              id="ce-headline"
              ref={headlineRef}
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              onBlur={() => setHeadlineTouched(true)}
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
                if (file && looksLikeBanner(file)) {
                  setRawFile(file);
                  setEditingBanner(true);
                } else if (file) {
                  toast.error(t.errInvalidImage);
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
                  if (file && looksLikeBanner(file)) {
                    setRawFile(file);
                    setEditingBanner(true);
                  } else if (file) {
                    toast.error(t.errInvalidImage);
                  }
                  e.target.value = "";
                }}
              />
              <label htmlFor="ce-banner" className="btn small">
                <IconPlus size={14} /> {t.upload}
              </label>
              {!rawFile && <span className="drop-zone-meta muted-2">{t.bannerDropHint}</span>}
              {rawFile && (
                <span className="drop-zone-meta muted-2">
                  {rawFile.name} · {formatBytes(rawFile.size, locale)}
                </span>
              )}
            </div>
            {bannerUrl && <FallImg className="banner-preview" src={bannerUrl} alt="" />}
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
        // Only content is review-locked; placements stay purchasable while the
        // campaign is under review (the quote API accepts submitted campaigns).
        <fieldset className="form-section flush" disabled={saved?.review_status === "suspended"}>
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
                min={toTashkentInput(new Date())}
                onChange={(e) => setStart(e.target.value)}
              />
              {startInPast && (
                <span className="field-error" role="alert">
                  {t.errStartInPast}
                </span>
              )}
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

          {/* Date presets: one tap instead of manual datetime math. Moving
              the start keeps the chosen duration. */}
          <div className="duration-presets" role="group" aria-label={t.presetStartLabel}>
            <span className="muted-2">{t.presetStartLabel}:</span>
            {[
              { value: presets.now, label: t.startNow },
              { value: presets.tomorrow, label: t.startTomorrow },
              { value: presets.nextMonday, label: t.startNextMonday },
            ].map(({ value, label }) => (
              <button
                key={label}
                type="button"
                className="btn subtle small"
                onClick={() => {
                  setStart(value);
                  if (durationMs > 0) {
                    setEnd(toTashkentInput(new Date(tashkentInputMs(value) + durationMs)));
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="duration-presets" role="group" aria-label={t.presetDurationLabel}>
            <span className="muted-2">{t.presetDurationLabel}:</span>
            {DURATION_PRESETS.map((days) => (
              <button
                key={days}
                type="button"
                className="btn subtle small"
                aria-pressed={durationMs === days * 86_400_000}
                onClick={() => setEnd(addDays(start, days))}
              >
                {days === 1 ? t.duration24h : `${days} ${plural(locale, "days", days)}`}
              </button>
            ))}
          </div>

          {/* Paid visibility add-on (Joymee's TOP/RAISE upsell, moved to
              checkout time): pick a tier, see the surcharge, pay it with the
              placement in ONE order — no wallet, no second state machine.
              Hidden entirely while the current tariff prices no tier. */}
          {tariff && (tariff.amount_top_per_24h != null || tariff.amount_raised_per_24h != null) && (
            <div className="promo-picker" role="radiogroup" aria-label={t.promoTitle}>
              <strong>{t.promoTitle}</strong>
              <div className="promo-options">
                <button
                  type="button"
                  className="promo-option"
                  role="radio"
                  aria-checked={promoTier === null}
                  onClick={() => setPromoTier(null)}
                >
                  <span className="promo-name">{t.promoNone}</span>
                  <span className="muted-2">{t.promoNoneDesc}</span>
                </button>
                {tariff.amount_top_per_24h != null && (
                  <button
                    type="button"
                    className="promo-option promo-top"
                    role="radio"
                    aria-checked={promoTier === "top"}
                    onClick={() => setPromoTier("top")}
                  >
                    <span className="promo-name">
                      <span className="promo-badge top">TOP</span>
                      {t.promoTopName}
                    </span>
                    <span className="muted-2">{t.promoTopDesc}</span>
                    <span className="promo-price">
                      +{formatMinor(tariff.amount_top_per_24h, tariff.currency, locale)}
                      {t.perDayShort}
                    </span>
                  </button>
                )}
                {tariff.amount_raised_per_24h != null && (
                  <button
                    type="button"
                    className="promo-option promo-raised"
                    role="radio"
                    aria-checked={promoTier === "raised"}
                    onClick={() => setPromoTier("raised")}
                  >
                    <span className="promo-name">
                      <span className="promo-badge raised">UP</span>
                      {t.promoRaisedName}
                    </span>
                    <span className="muted-2">{t.promoRaisedDesc}</span>
                    <span className="promo-price">
                      +{formatMinor(tariff.amount_raised_per_24h, tariff.currency, locale)}
                      {t.perDayShort}
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}

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
                  {selected.size} {plural(locale, "locations", selected.size)} × {estimateDays} {t.estimateDaysLabel}{" · "}
                  {formatMinor(tariff!.amount_per_24h, tariff!.currency, locale)} {t.perDay}
                  {promoRate != null && (
                    <>
                      {" · +"}
                      {formatMinor(promoRate, estimate.currency, locale)} {t.promoAddOn} {t.perDay}
                    </>
                  )}
                </span>
                <span className="muted-2">{t.estimateNote}</span>
              </>
            ) : selected.size === 0 ? (
              <span className="muted-2">{t.estimatePickLocations}</span>
            ) : (
              <span className="muted-2">{t.estimateNoTariff}</span>
            )}
          </div>

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
                      {formatDate(localInputToIso(start), locale)} → {formatDate(localInputToIso(end), locale)}
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
                <p className="muted-2">{t.bannerMissingPreview}</p>
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

          {/* Secondary actions share one row; the money action gets its own
              full-width row below so the hierarchy reads instantly instead of
              wrapping into an undifferentiated button pile. */}
          <div className="stage-actions">
            <button className="btn" onClick={() => setStage(1)}>
              <IconArrowLeft size={14} /> {t.back}
            </button>
            <div className="row">
              {saveButton}
              {canSubmit && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => submit.mutate()}
                >
                  {submit.isPending ? t.sending : t.submitWithoutPay}
                </button>
              )}
            </div>
          </div>
          {(canSubmit || canQuote) && (
            <div className="stage-primary">
              {canSubmit && (
                <button
                  className="btn primary"
                  disabled={busy || selected.size === 0 || startInPast}
                  onClick={() => payAndSubmit.mutate()}
                >
                  {payAndSubmit.isPending ? t.loading : t.payAndSubmit}
                </button>
              )}
              {canQuote && (
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => quote.mutate()}
                >
                  {quote.isPending ? t.loading : t.getQuoteAndPay}
                </button>
              )}
            </div>
          )}
          {(canSubmit || canQuote) && (
            <p className="field-hint">{t.payFirstNote}</p>
          )}
          {/* Every reason the money button can be disabled is spelled out
              right next to it — never a silently disabled primary. */}
          {canSubmit && (selected.size === 0 || startInPast) && (
            <p className="field-hint stage-hint">
              <IconAlert size={12} />{" "}
              {selected.size === 0 ? t.payNeedsBranches : t.errStartInPast}
            </p>
          )}
          {/* No banner = the only missing piece; offer the fix inline instead
              of a dead end that repeats the warning twice. */}
          {!locked && !approved && !bannerKey && (
            <div className="callout banner-missing" role="alert">
              <span>
                <IconAlert size={14} /> {t.bannerRequired}
              </span>
              <button className="btn small primary" onClick={() => setStage(0)}>
                <IconPlus size={14} /> {t.uploadBanner}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
