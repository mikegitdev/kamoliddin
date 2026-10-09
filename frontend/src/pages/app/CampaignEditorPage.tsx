import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useBusinessLocations, useBusinesses, useCampaign } from "@/shared/api/queries";
import { ApiError } from "@/shared/api/client";
import {
  createCampaign,
  requestQuote,
  submitCampaign,
  updateCampaign,
  uploadMedia,
} from "@/features/advertiser/api";
import { localInputToIso } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import type { ApiCampaign } from "@/entities/types";

function defaultDates(): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  const end = new Date(now.getTime() + 25 * 60 * 1000);
  return { start: fmt(start), end: fmt(end) };
}

/** Campaign editor: creates new drafts or edits an existing draft/rejected
 *  campaign (/app/campaigns/:id/edit). Content edits on approved campaigns
 *  bump review_version and force re-review (spec §7.1). */
export function CampaignEditorPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id: editId } = useParams<{ id: string }>();
  const { data: businesses } = useBusinesses();
  const business = businesses?.[0];
  const { data: locations } = useBusinessLocations(business?.id);
  const { data: editing } = useCampaign(editId);

  const dates = useMemo(defaultDates, []);
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [bannerKey, setBannerKey] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [start, setStart] = useState(dates.start);
  const [end, setEnd] = useState(dates.end);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [autoRenew, setAutoRenew] = useState(false); // default OFF (spec §8 [C])
  const [saved, setSaved] = useState<ApiCampaign | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const applyError = (e: unknown) => {
    if (e instanceof ApiError) {
      setError(e.message);
      const flat: Record<string, string> = {};
      for (const [key, messages] of Object.entries(e.fields ?? {})) {
        flat[key] = messages.join(" ");
      }
      setFieldErrors(flat);
    } else {
      setError(t.error);
    }
  };

  // Prefill from the campaign being edited (once, without clobbering user input).
  useEffect(() => {
    if (!editing || dirty || saved?.id === editing.id) return;
    setHeadline(editing.headline);
    setBody(editing.body);
    setBannerKey(editing.banner_key);
    setBannerUrl(editing.banner_url);
    setSaved(editing);
  }, [editing, dirty, saved]);

  const saveDraft = useMutation({
    mutationFn: async (): Promise<ApiCampaign> => {
      const payload = {
        business: business!.id,
        headline,
        body,
        banner_key: bannerKey || "banners/placeholder.jpg",
      };
      return saved ? updateCampaign(saved.id, payload) : createCampaign(payload);
    },
    onSuccess: (campaign) => {
      setSaved(campaign);
      setDirty(false);
      setStatus(t.campaignSaved);
      setError(null);
      setFieldErrors({});
    },
    onError: applyError,
  });

  const submit = useMutation({
    mutationFn: () => submitCampaign(saved!.id),
    onSuccess: (campaign) => {
      setSaved(campaign);
      setStatus(t.campaignSubmitted);
      setError(null);
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
    onSuccess: (order) => navigate(`/app/checkout/${order.id}`),
    onError: applyError,
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadMedia(file, "banners"),
    onSuccess: (res) => {
      setBannerKey(res.key);
      setBannerUrl(res.url);
      setDirty(true);
      setError(null);
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

  if (!business) {
    return (
      <section>
        <p className="callout">
          ℹ️ {t.createBusinessHint} — <Link to="/app/business">{t.business}</Link>
        </p>
      </section>
    );
  }

  const canSave = headline.trim().length > 2;
  const canSubmit =
    !!saved &&
    ["draft", "rejected"].includes(saved.review_status) &&
    !!bannerKey;
  const canQuote =
    !!saved &&
    ["submitted", "under_review", "approved"].includes(saved.review_status) &&
    selected.size > 0 &&
    !!bannerKey;

  return (
    <section className="form">
      <div className="row-between">
        <h2>{t.newCampaign}</h2>
        <Link to="/app/campaigns">← {t.backToCampaigns}</Link>
      </div>

      <div className="form-section" style={{ borderTop: "none", marginTop: 8, paddingTop: 0 }}>
        <h3 className="section-title">
          <span className="section-num">1</span>
          {t.secContent}
        </h3>

        <div className="field">
          <label htmlFor="ce-headline">{t.headline}</label>
          <input
            id="ce-headline"
            value={headline}
            onChange={(e) => {
              setHeadline(e.target.value);
              setDirty(true);
            }}
            maxLength={200}
            aria-describedby={fieldErrors.headline ? "ce-headline-err" : undefined}
          />
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
            onChange={(e) => {
              setBody(e.target.value);
              setDirty(true);
            }}
            rows={3}
          />
        </div>

        <div className="field">
          <label htmlFor="ce-banner">{t.banner}</label>
          <span className="field-hint" id="ce-banner-hint">
            {t.bannerFormats}
          </span>
          {bannerUrl && <img className="banner-preview" src={bannerUrl} alt="" />}
          <input
            id="ce-banner"
            className="file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-describedby="ce-banner-hint"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
            }}
          />
          {upload.isPending && <p className="muted-2">{t.loading}</p>}
          {fieldErrors.banner_key && (
            <span className="field-error" role="alert">
              {fieldErrors.banner_key}
            </span>
          )}
        </div>
      </div>

      <div className="form-section">
        <h3 className="section-title">
          <span className="section-num">2</span>
          {t.secBranches}
          {selected.size > 0 && (
            <span className="chip blue">
              {t.branchesSelected}: {selected.size}
            </span>
          )}
        </h3>
        {locations && locations.length === 0 && (
          <p className="callout">
            ℹ️ {t.noBranches} — <Link to="/app/locations">{t.addBranch}</Link>
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
      </div>

      <div className="form-section">
        <h3 className="section-title">
          <span className="section-num">3</span>
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
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="form-section">
        <h3 className="section-title">
          <span className="section-num">4</span>
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
      </div>

      <div className="form-actions">
        <button
          className="btn"
          disabled={!canSave || saveDraft.isPending}
          onClick={() => saveDraft.mutate()}
        >
          {saveDraft.isPending ? t.saving : t.saveDraft}
        </button>
        <button
          className="btn"
          disabled={!canSubmit || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? t.sending : t.submitReview}
        </button>
        <button
          className="btn primary"
          disabled={!canQuote || quote.isPending}
          onClick={() => quote.mutate()}
        >
          {quote.isPending ? t.loading : t.getQuoteAndPay}
        </button>
      </div>
      {!bannerKey && <p className="field-hint">⚠ {t.bannerRequired}</p>}
      {dirty && saved && <p className="field-hint">{t.unsavedHint}</p>}
      {status && (
        <p className="ok" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
