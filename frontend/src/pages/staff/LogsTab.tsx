import { Fragment, useEffect, useState } from "react";
import {
  useStaffPage,
  type ApiActivity,
  type ApiAdminPayment,
  type ApiAdminPaymentEvent,
  type ApiAdminRenewalAttempt,
} from "@/shared/api/queries";
import { formatDateTime, formatMinor } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { AttemptChip, OrderChip, QueryError } from "@/shared/ui";
import type { OrderState } from "@/entities/types";
import { IconChevronDown, IconChevronUp, IconSave } from "@/shared/icons";
import {
  FilterPill,
  ServerPager,
  SubTabs,
  shortId,
  useDebounced,
  useHistoryState,
  usePagedOffset,
  useStaffLink,
} from "./controls";

type View = "audit" | "payments" | "webhooks" | "renewals";

const ENTITIES = [
  "campaign", "placement", "business", "location", "user", "order",
  "renewal_agreement", "report", "platform_setting", "activity",
];

/** One place for every log the platform keeps: the immutable staff/system
 *  audit trail, payment attempts, raw provider webhooks and renewal runs. */
export function LogsTab({ locale }: { locale: string }) {
  const { t } = useI18n();
  const link = useStaffLink();
  const [view, setView] = useState<View>(() => {
    const v = link.get("view");
    return v === "payments" || v === "webhooks" || v === "renewals" ? v : "audit";
  });
  const lang = locale as "ru" | "uz";
  // An entity/actor drill-down always lands on the audit trail.
  const pin = link.get("entity_id") || link.get("actor");
  useEffect(() => {
    if (pin) setView("audit");
  }, [pin]);
  return (
    <section>
      <SubTabs<View>
        value={view}
        onChange={setView}
        options={[
          ["audit", t.logAudit],
          ["payments", t.logPayments],
          ["webhooks", t.logWebhooks],
          ["renewals", t.logRenewals],
        ]}
      />
      {view === "audit" && <AuditLog lang={lang} />}
      {view === "payments" && <PaymentsLog lang={lang} />}
      {view === "webhooks" && <WebhooksLog lang={lang} />}
      {view === "renewals" && <RenewalsLog lang={lang} />}
    </section>
  );
}

/** Where an audit entity can be opened in the console, if anywhere. */
function entityTarget(entity: string, id: string): [string, Record<string, string>] | null {
  switch (entity) {
    case "user":
      return ["users", { user: id }];
    case "business":
      return ["businesses", { business: id }];
    case "location":
      return ["placements", { location: id }];
    case "campaign":
      return ["placements", { campaign: id }];
    default:
      return null;
  }
}

function AuditLog({ lang }: { lang: "ru" | "uz" }) {
  const { t } = useI18n();
  const link = useStaffLink();
  // URL drill-downs (?entity=&entity_id=, ?actor=) pin filters as pills.
  const pinnedEntity = link.get("entity");
  const pinnedEntityId = link.get("entity_id");
  const pinnedActor = link.get("actor");
  const [entitySel, setEntitySel] = useHistoryState("logs.entity", "");
  const [actionInput, setActionInput] = useHistoryState("logs.action", "");
  const [actorInput, setActorInput] = useHistoryState("logs.actor", "");
  const [qInput, setQInput] = useHistoryState("logs.q", "");
  const [since, setSince] = useHistoryState("logs.since", "");
  const [until, setUntil] = useHistoryState("logs.until", "");
  const action = useDebounced(actionInput);
  const actorTyped = useDebounced(actorInput);
  const q = useDebounced(qInput);
  const params = {
    entity: pinnedEntity || entitySel,
    entity_id: pinnedEntityId,
    actor: pinnedActor || actorTyped,
    action,
    q,
    since,
    until,
  };
  const [offset, setOffset] = usePagedOffset("logs.offset", params);
  const { data, isLoading, isError, refetch } = useStaffPage<ApiActivity>("activity", params, offset);
  const [open, setOpen] = useState<string | null>(null);

  const exportQs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  ).toString();

  return (
    <>
      <div className="row mb-14">
        <input
          placeholder={`${t.action}: campaign.approve…`}
          value={actionInput}
          onChange={(e) => setActionInput(e.target.value)}
          className="max-w-220"
          aria-label={t.action}
        />
        {!pinnedEntity && (
          <select value={entitySel} onChange={(e) => setEntitySel(e.target.value)} aria-label={t.entity}>
            <option value="">{t.entity}: {t.statusAll}</option>
            {ENTITIES.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        )}
        {!pinnedActor && (
          <input
            placeholder={`${t.actor}: +998… / system`}
            value={actorInput}
            onChange={(e) => setActorInput(e.target.value)}
            className="max-w-220"
            aria-label={t.actor}
          />
        )}
        <input
          placeholder={`ID / ${t.reason}…`}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          className="max-w-220"
          aria-label={t.search}
        />
        <label className="row muted-2">
          {t.dateFrom}
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </label>
        <label className="row muted-2">
          {t.dateTo}
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <a
          className="btn small"
          href={`/api/v1/admin/activity/export${exportQs ? `?${exportQs}` : ""}`}
          download
        >
          <IconSave size={12} /> {t.exportCsv}
        </a>
      </div>
      {(pinnedEntity || pinnedEntityId || pinnedActor) && (
        <div className="row mb-14">
          {(pinnedEntity || pinnedEntityId) && (
            <FilterPill
              label={`${pinnedEntity || t.entity}${pinnedEntityId ? `:${shortId(pinnedEntityId)}` : ""}`}
              onClear={() => link.clear("entity", "entity_id")}
            />
          )}
          {pinnedActor && <FilterPill label={pinnedActor} onClear={() => link.clear("actor")} />}
        </div>
      )}
      {isLoading && <div className="skeleton skeleton-card" />}
      {isError && <QueryError onRetry={() => refetch()} />}
      {data && (
        <p className="muted-2 mb-10">
          {t.countLabel}: {data.count}
        </p>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.time}</th>
              <th>{t.action}</th>
              <th>{t.entity}</th>
              <th>{t.actor}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.results.map((e) => {
              const target = entityTarget(e.entity, e.entity_id);
              const hasMeta = Object.keys(e.metadata ?? {}).length > 0;
              return (
                <Fragment key={e.id}>
                  <tr>
                    <td className="muted-2">{formatDateTime(e.created_at, lang)}</td>
                    <td>
                      <code>{e.action}</code>
                    </td>
                    <td className="muted-2">
                      <button
                        className="link-button"
                        title={e.entity_id}
                        onClick={() => link.go("logs", { entity: e.entity, entity_id: e.entity_id })}
                      >
                        {e.entity}:{shortId(e.entity_id)}
                      </button>
                      {target && (
                        <button className="btn subtle small" onClick={() => link.go(...target)}>
                          {t.openEntity}
                        </button>
                      )}
                    </td>
                    <td className="muted-2">{e.actor_phone ?? t.system}</td>
                    <td>
                      {hasMeta && (
                        <button
                          className="btn subtle small"
                          aria-expanded={open === e.id}
                          onClick={() => setOpen(open === e.id ? null : e.id)}
                        >
                          {open === e.id ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
                        </button>
                      )}
                    </td>
                  </tr>
                  {open === e.id && (
                    <tr>
                      <td colSpan={5}>
                        <pre className="staff-meta">{JSON.stringify(e.metadata, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {data && <ServerPager count={data.count} offset={offset} onOffset={setOffset} />}
    </>
  );
}

function PaymentsLog({ lang }: { lang: "ru" | "uz" }) {
  const { t } = useI18n();
  const link = useStaffLink();
  const order = link.get("order");
  const [status, setStatus] = useState("");
  const [qInput, setQInput] = useState("");
  const q = useDebounced(qInput);
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [status, q, order]);
  const { data, isLoading, isError, refetch } = useStaffPage<ApiAdminPayment>("payments", { status, q, order }, offset);
  return (
    <>
      <div className="row mb-14">
        <input
          placeholder={`${t.businessesTab} / provider ID…`}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          className="max-w-280"
          aria-label={t.search}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t.status}>
          <option value="">{t.statusAll}</option>
          <option value="succeeded">{t.stAttemptSucceeded}</option>
          <option value="pending">{t.stAttemptPending}</option>
          <option value="failed">{t.stAttemptFailed}</option>
        </select>
        {order && (
          <FilterPill label={`${t.orderLabel} ${shortId(order)}`} onClear={() => link.clear("order")} />
        )}
      </div>
      {isLoading && <div className="skeleton skeleton-card" />}
      {isError && <QueryError onRetry={() => refetch()} />}
      {data && (
        <p className="muted-2 mb-10">
          {t.countLabel}: {data.count}
        </p>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.time}</th>
              <th>{t.businessesTab}</th>
              <th>{t.amount}</th>
              <th>{t.status}</th>
              <th>{t.provider}</th>
              <th>{t.events}</th>
            </tr>
          </thead>
          <tbody>
            {data?.results.map((p) => (
              <tr key={p.id}>
                <td className="muted-2">{formatDateTime(p.created_at, lang)}</td>
                <td className="max-w-240 wrap-anywhere">
                  {p.business_name}
                  <div className="muted-2">{p.campaign_headline}</div>
                </td>
                <td>{formatMinor(p.amount, "UZS", lang)}</td>
                <td>
                  <AttemptChip status={p.status} />
                  <div>
                    <OrderChip state={p.order_state as OrderState} />
                  </div>
                </td>
                <td className="muted-2">
                  {p.provider}
                  <div title={p.provider_payment_id}>{p.provider_payment_id ? shortId(p.provider_payment_id) : "—"}</div>
                </td>
                <td>{p.events_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <ServerPager count={data.count} offset={offset} onOffset={setOffset} />}
    </>
  );
}

function WebhooksLog({ lang }: { lang: "ru" | "uz" }) {
  const { t } = useI18n();
  const [qInput, setQInput] = useState("");
  const q = useDebounced(qInput);
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [q]);
  const { data, isLoading, isError, refetch } = useStaffPage<ApiAdminPaymentEvent>("payment-events", { q }, offset);
  return (
    <>
      <div className="row mb-14">
        <input
          placeholder={`${t.eventId}…`}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          className="max-w-280"
          aria-label={t.eventId}
        />
      </div>
      {isLoading && <div className="skeleton skeleton-card" />}
      {isError && <QueryError onRetry={() => refetch()} />}
      {data && (
        <p className="muted-2 mb-10">
          {t.countLabel}: {data.count}
        </p>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.receivedAt}</th>
              <th>{t.provider}</th>
              <th>{t.eventId}</th>
              <th>{t.status}</th>
              <th>{t.orderLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data?.results.map((e) => (
              <tr key={e.id}>
                <td className="muted-2">{formatDateTime(e.received_at, lang)}</td>
                <td>{e.provider}</td>
                <td className="wrap-anywhere">
                  <code>{e.event_id}</code>
                </td>
                <td>{e.payment_status ? <AttemptChip status={e.payment_status} /> : "—"}</td>
                <td className="muted-2" title={e.order_id ?? ""}>
                  {shortId(e.order_id)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <ServerPager count={data.count} offset={offset} onOffset={setOffset} />}
    </>
  );
}

const RENEWAL_STATE_CLASS: Record<string, string> = {
  succeeded: "chip green",
  pending: "chip orange",
  failed: "chip red",
  reconciliation: "chip red",
};

function RenewalsLog({ lang }: { lang: "ru" | "uz" }) {
  const { t } = useI18n();
  const link = useStaffLink();
  const [state, setState] = useState("");
  const [qInput, setQInput] = useState("");
  const q = useDebounced(qInput);
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [state, q]);
  const { data, isLoading, isError, refetch } = useStaffPage<ApiAdminRenewalAttempt>("renewals", { state, q }, offset);
  const stateLabel: Record<string, string> = {
    succeeded: t.stAttemptSucceeded,
    pending: t.stAttemptPending,
    failed: t.stAttemptFailed,
    reconciliation: t.stReconciliation,
  };
  const agreementLabel: Record<string, string> = {
    active: t.stActive,
    alert: t.stAlert,
    disabled: t.stDisabled,
    pending_token: t.stPendingToken,
  };
  return (
    <>
      <div className="row mb-14">
        <input
          placeholder={`${t.businessesTab} / ${t.campaign}…`}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          className="max-w-280"
          aria-label={t.search}
        />
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label={t.status}>
          <option value="">{t.statusAll}</option>
          <option value="succeeded">{t.stAttemptSucceeded}</option>
          <option value="failed">{t.stAttemptFailed}</option>
          <option value="reconciliation">{t.stReconciliation}</option>
          <option value="pending">{t.stAttemptPending}</option>
        </select>
      </div>
      {isLoading && <div className="skeleton skeleton-card" />}
      {isError && <QueryError onRetry={() => refetch()} />}
      {data && (
        <p className="muted-2 mb-10">
          {t.countLabel}: {data.count}
        </p>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.time}</th>
              <th>{t.campaign}</th>
              <th>{t.period}</th>
              <th>{t.status}</th>
              <th>{t.agreement}</th>
              <th>{t.amount}</th>
            </tr>
          </thead>
          <tbody>
            {data?.results.map((r) => (
              <tr key={r.id}>
                <td className="muted-2">{formatDateTime(r.attempted_at, lang)}</td>
                <td className="max-w-240 wrap-anywhere">
                  {r.campaign_headline}
                  <div className="muted-2">{r.business_name}</div>
                </td>
                <td className="muted-2">
                  <code>{r.renewal_period_key}</code>
                </td>
                <td>
                  <span className={RENEWAL_STATE_CLASS[r.state] ?? "chip gray"}>
                    {stateLabel[r.state] ?? r.state}
                  </span>
                </td>
                <td className="muted-2">
                  <button
                    className="link-button"
                    onClick={() =>
                      link.go("logs", { entity: "renewal_agreement", entity_id: r.agreement_id })
                    }
                  >
                    {agreementLabel[r.agreement_status] ?? r.agreement_status}
                  </button>
                </td>
                <td>{r.amount != null ? formatMinor(r.amount, "UZS", lang) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <ServerPager count={data.count} offset={offset} onOffset={setOffset} />}
    </>
  );
}
