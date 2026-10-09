import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api/client";
import {
  useActivity,
  useAdminCampaigns,
  useAdminOrders,
  useAdminOverview,
  useAdLimit,
  useGrantOptions,
  useRefunds,
  useReports,
  useReviewQueue,
  useSession,
} from "@/shared/api/queries";
import { formatDateTime, formatMinor } from "@/shared/format";
import { LanguageSwitcher, useI18n } from "@/shared/i18n";

type Tab =
  | "overview"
  | "queue"
  | "reports"
  | "campaigns"
  | "refunds"
  | "orders"
  | "activity"
  | "grants"
  | "settings";

const TABS: Tab[] = [
  "overview", "queue", "reports", "campaigns", "refunds",
  "orders", "activity", "grants", "settings",
];

/** Staff moderation console (spec §12): review queue, refunds, grants, settings. */
export function StaffPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { data: user, isLoading } = useSession();
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);

  if (!isLoading && (!user || !user.is_staff)) {
    navigate("/login");
  }

  const tabLabel: Record<Tab, string> = {
    overview: t.adminOverview,
    queue: t.reviewQueue,
    reports: t.reportsTab,
    campaigns: t.campaignsTab,
    refunds: t.refunds,
    orders: t.ordersTab,
    activity: t.activityTab,
    grants: t.grants,
    settings: t.settings,
  };

  return (
    <div className="page app-page">
      <header className="app-header">
        <Link to="/" className="brand" style={{ boxShadow: "var(--shadow-xs)" }}>
          <span className="logo">🛡️</span>
          <span>
            {t.staffTitle}
            <small>{t.appTitle}</small>
          </span>
        </Link>
        <div className="row">
          <span className="app-user">
            <span className="avatar">ST</span>
            {user?.phone_e164 ?? "…"}
          </span>
          <LanguageSwitcher />
          <button className="btn small" onClick={() => navigate("/")}>
            ← {t.back}
          </button>
        </div>
      </header>

      <nav className="app-nav">
        {TABS.map((k) => (
          <button
            key={k}
            className={tab === k ? "active" : ""}
            style={{ background: "none", border: "none", cursor: "pointer" }}
            onClick={() => setTab(k)}
          >
            {tabLabel[k]}
          </button>
        ))}
      </nav>

      {error && <p className="error">{error}</p>}
      <main>
        {tab === "overview" && <AdminOverviewTab />}
        {tab === "queue" && <QueueTab onError={setError} locale={locale} />}
        {tab === "reports" && <ReportsTab onError={setError} locale={locale} />}
        {tab === "campaigns" && <CampaignsTab onError={setError} locale={locale} />}
        {tab === "refunds" && <RefundsTab onError={setError} locale={locale} />}
        {tab === "orders" && <OrdersTab locale={locale} />}
        {tab === "activity" && <ActivityTab locale={locale} />}
        {tab === "grants" && <GrantsTab onError={setError} />}
        {tab === "settings" && <SettingsTab onError={setError} />}
      </main>
    </div>
  );
}

function QueueTab({
  onError,
  locale,
}: {
  onError: (e: string | null) => void;
  locale: string;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: queue, isLoading } = useReviewQueue(true);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const review = async (id: string, decision: "approve" | "reject") => {
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
      {queue?.length === 0 && <p className="callout">✅ {t.queueEmpty}</p>}
      <div className="review-list">
        {queue?.map((c) => (
          <article key={c.id} className="review-card">
            <img className="review-banner" src={c.banner_url} alt="" loading="lazy" />
            <div className="review-body">
              <div className="row-between">
                <strong>{c.headline}</strong>
                <span className="chip pending">v{c.review_version}</span>
              </div>
              <p className="muted-2" style={{ whiteSpace: "pre-wrap" }}>
                {c.body}
              </p>
              <div className="muted-2">
                🏪 {c.business_name} · 📞 {c.owner_phone}
              </div>
              <div className="muted-2">
                📍 {c.locations.length ? c.locations.join(", ") : t.noLocations}
              </div>
              <div className="muted-2">
                ⏱ {formatDateTime(c.updated_at, locale as "ru" | "uz")}
              </div>
              {rejecting === c.id ? (
                <div className="stack">
                  <input
                    placeholder={t.reason}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    autoFocus
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
                    onClick={() => review(c.id, "approve")}
                  >
                    ✓ {t.approve}
                  </button>
                  <button
                    className="btn danger small"
                    disabled={busy}
                    onClick={() => setRejecting(c.id)}
                  >
                    ✕ {t.reject}
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function RefundsTab({
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
      {refunds?.length === 0 && <p className="callout">✅ {t.noRefunds}</p>}
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
            {refunds?.map((r) => (
              <tr key={r.id}>
                <td>{r.campaign_headline}</td>
                <td>{r.business_name}</td>
                <td>{formatMinor(r.amount, "UZS", locale as "ru" | "uz")}</td>
                <td className="muted-2">{r.reason}</td>
                <td>
                  <span className={`chip ${r.state === "requested" ? "pending" : "ok"}`}>
                    {r.state}
                  </span>
                </td>
                <td>
                  {r.state === "requested" && (
                    <div className="row">
                      <button
                        className="btn primary small"
                        disabled={busy === r.id}
                        onClick={() => process(r.id, "approve")}
                      >
                        ✓ {t.approve}
                      </button>
                      <button
                        className="btn danger small"
                        disabled={busy === r.id}
                        onClick={() => process(r.id, "reject")}
                      >
                        ✕ {t.reject}
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
    </section>
  );
}

function GrantsTab({ onError }: { onError: (e: string | null) => void }) {
  const { t } = useI18n();
  const { data: options } = useGrantOptions(true);
  const [campaignId, setCampaignId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

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
    <section className="card" style={{ maxWidth: 560 }}>
      <h2>{t.issueGrant}</h2>
      <p className="muted-2">{t.grantHint}</p>
      {ok && <p className="callout ok">✅ {t.grantIssued}</p>}
      <label>{t.campaign}</label>
      <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
        <option value="">—</option>
        {options?.campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.headline} · {c.business_name}
          </option>
        ))}
      </select>
      <label>{t.branch}</label>
      <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
        <option value="">—</option>
        {options?.locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} · {l.business_name}
          </option>
        ))}
      </select>
      <label>{t.startDate}</label>
      <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
      <label>{t.endDate}</label>
      <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
      <label>{t.reason}</label>
      <input value={reason} onChange={(e) => setReason(e.target.value)} />
      <button
        className="btn primary"
        style={{ marginTop: 12 }}
        disabled={busy || !valid}
        onClick={submit}
      >
        {busy ? "…" : t.issueGrant}
      </button>
    </section>
  );
}

function SettingsTab({ onError }: { onError: (e: string | null) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data } = useAdLimit(true);
  const [value, setValue] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  const current = value === "" ? data?.value ?? 5 : value;

  const save = async () => {
    setBusy(true);
    onError(null);
    setOk(false);
    try {
      await api("/api/v1/admin/settings/ad-limit", {
        method: "PATCH",
        json: { value: current },
      });
      setOk(true);
      setValue("");
      qc.invalidateQueries({ queryKey: ["staff", "ad-limit"] });
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" style={{ maxWidth: 560 }}>
      <h2>{t.settings}</h2>
      {ok && <p className="callout ok">✅ {t.saved}</p>}
      <label>{t.adLimit}</label>
      <input
        type="number"
        min={1}
        max={50}
        value={current}
        onChange={(e) => setValue(Number(e.target.value))}
      />
      <p className="muted-2">{t.adLimitHint}</p>
      <button className="btn primary" style={{ marginTop: 8 }} disabled={busy} onClick={save}>
        {busy ? "…" : t.save}
      </button>
    </section>
  );
}

function AdminOverviewTab() {
  const { t, locale } = useI18n();
  const { data, isLoading } = useAdminOverview(true);
  const lang = locale as "ru" | "uz";
  if (isLoading) return <div className="skeleton skeleton-card" />;
  if (!data) return null;
  return (
    <section>
      <div className="cards">
        <div className="stat-card">
          <span className="icon">⏳</span>
          <span className="num">{data.queue_depth}</span>
          <span className="muted-2">{t.pendingReview}</span>
        </div>
        <div className="stat-card">
          <span className="icon">🚩</span>
          <span className="num">{data.open_reports}</span>
          <span className="muted-2">{t.openReports}</span>
        </div>
        <div className="stat-card">
          <span className="icon">💵</span>
          <span className="num">{data.refunds_requested}</span>
          <span className="muted-2">{t.refundsPending}</span>
        </div>
        <div className="stat-card">
          <span className="icon">🟢</span>
          <span className="num">{data.active_placements}</span>
          <span className="muted-2">{t.activePlacements}</span>
        </div>
        <div className="stat-card">
          <span className="icon">💰</span>
          <span className="num" style={{ fontSize: "1.1rem" }}>
            {formatMinor(data.revenue.month, "UZS", lang)}
          </span>
          <span className="muted-2">{t.thisMonth}</span>
        </div>
        <div className="stat-card">
          <span className="icon">👥</span>
          <span className="num">{data.owners}</span>
          <span className="muted-2">{t.ownersCount}</span>
        </div>
      </div>
      <p className="muted-2" style={{ marginTop: 10 }}>
        {t.totalSpent}: {formatMinor(data.revenue.total, "UZS", lang)}
      </p>
    </section>
  );
}

function ReportsTab({
  onError,
  locale,
}: {
  onError: (e: string | null) => void;
  locale: string;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: reports, isLoading } = useReports(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const lang = locale as "ru" | "uz";

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
      qc.invalidateQueries({ queryKey: ["staff", "reports"] });
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      {isLoading && <div className="skeleton skeleton-card" />}
      {reports?.length === 0 && <p className="callout">✅ {t.noReports}</p>}
      <div className="review-list">
        {reports?.map((r) => (
          <article key={r.id} className="review-card">
            <div className="review-body">
              <div className="row-between">
                <strong>
                  {r.entity === "campaign" ? "📣" : "📍"} {r.entity} · …
                  {r.entity_id.slice(0, 8)}
                </strong>
                <span
                  className={`chip ${r.state === "open" ? "orange" : r.state === "resolved" ? "green" : "gray"}`}
                >
                  {r.state}
                </span>
              </div>
              <p className="muted-2">{r.reason}</p>
              <div className="muted-2">⏱ {formatDateTime(r.created_at, lang)}</div>
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
                      placeholder={t.note}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      autoFocus
                    />
                    <div className="row">
                      <button
                        className="btn primary small"
                        disabled={busy}
                        onClick={() => process(r.id, "resolve")}
                      >
                        ✓ {t.resolve}
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
                  <button
                    className="btn small"
                    onClick={() => setProcessing(r.id)}
                  >
                    ⚖️ {t.process}
                  </button>
                ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CampaignsTab({
  onError,
  locale,
}: {
  onError: (e: string | null) => void;
  locale: string;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [suspending, setSuspending] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: campaigns, isLoading } = useAdminCampaigns(true, q, status);
  const lang = locale as "ru" | "uz";

  const act = async (id: string, action: "suspend" | "unsuspend") => {
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
      <div className="row" style={{ marginBottom: 14 }}>
        <input
          placeholder={`🔍 ${t.search}…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t.statusAll}</option>
          <option value="approved">{t.stApproved}</option>
          <option value="suspended">{t.stSuspended}</option>
          <option value="submitted">{t.stSubmitted}</option>
          <option value="rejected">{t.stRejected}</option>
          <option value="draft">{t.stDraft}</option>
        </select>
      </div>
      {isLoading && <div className="skeleton skeleton-card" />}
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
            {campaigns?.map((c) => (
              <tr key={c.id}>
                <td style={{ maxWidth: 240, overflowWrap: "anywhere" }}>
                  <strong>{c.headline}</strong>
                </td>
                <td className="muted-2">
                  {c.business_name}
                  <div>{c.owner_phone}</div>
                </td>
                <td>
                  <span
                    className={`chip ${c.review_status === "approved" ? "green" : c.review_status === "suspended" ? "red" : "gray"}`}
                  >
                    {c.review_status}
                  </span>
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
                        />
                        <div className="row">
                          <button
                            className="btn danger small"
                            disabled={busy}
                            onClick={() => act(c.id, "suspend")}
                          >
                            ⛔ {t.suspend}
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
                        ⛔ {t.suspend}
                      </button>
                    ))}
                  {c.review_status === "suspended" && (
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() => act(c.id, "unsuspend")}
                    >
                      ✅ {t.unsuspend}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OrdersTab({ locale }: { locale: string }) {
  const { t } = useI18n();
  const { data: orders, isLoading } = useAdminOrders(true);
  const lang = locale as "ru" | "uz";
  return (
    <section>
      {isLoading && <div className="skeleton skeleton-card" />}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.forBusiness}</th>
              <th>{t.campaign}</th>
              <th>{t.total}</th>
              <th>{t.status}</th>
              <th>{t.secSchedule}</th>
            </tr>
          </thead>
          <tbody>
            {orders?.map((o) => (
              <tr key={o.id}>
                <td>{o.business_name}</td>
                <td className="muted-2" style={{ maxWidth: 220, overflowWrap: "anywhere" }}>
                  {o.campaign_headline}
                </td>
                <td>{formatMinor(o.amount_total, o.currency, lang)}</td>
                <td>
                  <span className={`chip ${o.state === "paid" ? "green" : "gray"}`}>
                    {o.state}
                  </span>
                </td>
                <td className="muted-2">{formatDateTime(o.created_at, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ActivityTab({ locale }: { locale: string }) {
  const { data: events, isLoading } = useActivity(true);
  const lang = locale as "ru" | "uz";
  return (
    <section>
      {isLoading && <div className="skeleton skeleton-card" />}
      <ul className="list">
        {events?.map((e) => (
          <li key={e.id} className="row-between">
            <div>
              <strong>{e.action}</strong>
              <div className="muted-2">
                {e.entity}:{e.entity_id.slice(0, 8)} ·{" "}
                {e.actor_phone ?? "system"}
              </div>
            </div>
            <span className="muted-2">{formatDateTime(e.created_at, lang)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
