import { useState } from "react";
import { api, ApiError } from "@/shared/api/client";
import { useGrantOptions } from "@/shared/api/queries";
import { formatDateTime } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { IconCheck } from "@/shared/icons";

export function GrantsTab({ onError }: { onError: (e: string | null) => void }) {
  const { t, locale } = useI18n();
  const { data: options, isLoading: isLoadingOptions } = useGrantOptions(true);
  const lang = locale as "ru" | "uz";
  const [campaignId, setCampaignId] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("");
  const [locationId, setLocationId] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  // Client-side filters keep the grant selects usable as option lists grow.
  const filterOptions = (q: string, label: string) =>
    q.trim() === "" || label.toLowerCase().includes(q.trim().toLowerCase());
  const campaignOptions = (options?.campaigns ?? []).filter((c) =>
    filterOptions(campaignFilter, `${c.headline} ${c.business_name}`),
  );
  const locationOptions = (options?.locations ?? []).filter((l) =>
    filterOptions(locationFilter, `${l.name} ${l.business_name}`),
  );

  const submit = async () => {
    setBusy(true);
    onError(null);
    setOk(false);
    try {
      await api("/api/v1/admin/grants", {
        method: "POST",
        json: {
          campaign_id: campaignId,
          location_id: locationId,
          start_at: new Date(start).toISOString(),
          end_at: new Date(end).toISOString(),
          reason,
        },
      });
      setOk(true);
      setCampaignId("");
      setLocationId("");
      setStart("");
      setEnd("");
      setReason("");
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const valid = campaignId && locationId && start && end && reason.trim() && new Date(end) > new Date(start);

  return (
    <>
      <section className="card max-w-620">
        <h2>{t.issueGrant}</h2>
        <p className="muted-2">{t.grantHint}</p>
        {ok && <p className="callout ok"><IconCheck size={16} /> {t.grantIssued}</p>}
        <label htmlFor="grant-campaign">{t.campaign}</label>
        <input
          id="grant-campaign-filter"
          placeholder={`${t.search}…`}
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          aria-label={`${t.campaign} — ${t.search}`}
        />
        <select
          id="grant-campaign"
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
        >
          <option value="">—</option>
          {campaignOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.headline} · {c.business_name}
            </option>
          ))}
        </select>
        <label htmlFor="grant-location">{t.branch}</label>
        <input
          id="grant-location-filter"
          placeholder={`${t.search}…`}
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          aria-label={`${t.branch} — ${t.search}`}
        />
        <select
          id="grant-location"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          <option value="">—</option>
          {locationOptions.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} · {l.business_name}
            </option>
          ))}
        </select>
        <label htmlFor="grant-start">{t.startDate}</label>
        <input
          id="grant-start"
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <label htmlFor="grant-end">{t.endDate}</label>
        <input
          id="grant-end"
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
        />
        <label htmlFor="grant-reason">{t.reason}</label>
        <input
          id="grant-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          className="btn primary mt-12"
          disabled={busy || !valid}
          onClick={submit}
        >
          {busy ? "…" : t.issueGrant}
        </button>
      </section>

      {/* Issued grants: auditable, with campaign/location context. */}
      <section className="mt-22">
        <h2>{t.activeGrants}</h2>
        {isLoadingOptions && <div className="skeleton skeleton-card" />}
        {options && options.grants.length === 0 && (
          <p className="callout"><IconCheck size={16} /> {t.noGrants}</p>
        )}
        <ul className="list">
          {options?.grants.map((g) => (
            <li key={g.id} className="row-between">
              <div className="min-w-0">
                <strong>{g.campaign_headline}</strong>
                <div className="muted-2">
                  {g.location_name} · {g.business_name} · {g.reason}
                </div>
              </div>
              <div className="stack grant-side">
                <span className="chip blue">
                  {formatDateTime(g.start_at, lang)} → {formatDateTime(g.end_at, lang)}
                </span>
                <span className="muted-2">
                  {t.issuedBy}: {g.admin_phone ?? "—"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
