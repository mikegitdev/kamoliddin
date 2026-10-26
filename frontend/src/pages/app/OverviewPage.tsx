import { Link } from "react-router-dom";
import {
  useBusinessLocations,
  useBusinesses,
  useCampaigns,
  useMeSummary,
  useOrders,
} from "@/shared/api/queries";
import { useCurrentBusiness } from "@/features/advertiser/currentBusiness";
import { formatDateTime, formatMinor, formatRelative } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import {
  IconAlert,
  IconCalendar,
  IconCheck,
  IconClock,
  IconEye,
  IconMoney,
  IconPin,
  IconRocket,
} from "@/shared/icons";
import type { ApiCampaign, ApiOrder } from "@/entities/types";

interface SetupStep {
  done: boolean;
  label: string;
  href: string;
  cta: string;
}

/* ---------- "Needs your attention": actionable states first ---------- */

interface AttentionItem {
  key: string;
  tone: "danger" | "warn" | "quiet";
  title: string;
  meta?: string;
  actionLabel: string;
  to: string;
}

const TONE_RANK = { danger: 0, warn: 1, quiet: 2 } as const;

/** Derive the actionable items from loaded owner data. A source that has not
 *  loaded (or failed) contributes nothing — no false alarms while pending.
 *  Every item carries the one action that resolves it. */function attentionItems(
  campaigns: ApiCampaign[] | undefined,
  orders: ApiOrder[] | undefined,
  t: ReturnType<typeof useI18n>["t"],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const c of campaigns ?? []) {
    if (c.review_status === "rejected") {
      items.push({
        key: `rejected:${c.id}`,
        tone: "danger",
        title: t.attRejected,
        meta: c.headline,
        actionLabel: t.rejectionFixBtn,
        to: `/app/campaigns/${c.id}/edit`,
      });
    }
  }
  for (const o of orders ?? []) {
    if (o.state === "awaiting_payment") {
      items.push({
        key: `order:${o.id}`,
        tone: "warn",
        title: t.attUnpaid,
        meta: o.campaign_headline,
        actionLabel: t.createPayment,
        to: `/app/checkout/${o.id}`,
      });
    } else if (o.state === "failed") {
      items.push({
        key: `order:${o.id}`,
        tone: "danger",
        title: t.attPaymentFailed,
        meta: o.campaign_headline,
        actionLabel: t.retry,
        to: `/app/checkout/${o.id}`,
      });
    } else if (o.state === "expired") {
      items.push({
        key: `order:${o.id}`,
        tone: "warn",
        title: t.attQuoteExpired,
        meta: o.campaign_headline,
        actionLabel: t.details,
        to: `/app/campaigns/${o.campaign}`,
      });
    }
  }
  for (const c of campaigns ?? []) {
    if (c.review_status === "draft") {
      items.push({
        key: `draft:${c.id}`,
        tone: "quiet",
        title: t.attDraft,
        meta: c.headline,
        actionLabel: t.continueDraft,
        to: `/app/campaigns/${c.id}/edit`,
      });
    }
  }
  return items.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
}

function AttentionSection({ items }: { items: AttentionItem[] }) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <div className="card attention-card">
      <div className="row-between">
        <h2>{t.needsAttention}</h2>
        <span className="chip orange">{items.length}</span>
      </div>
      <ul className="attention-list">
        {items.map((item) => (
          <li key={item.key} className={`attention-item ${item.tone}`}>
            <div className="attention-text">
              <strong>{item.title}</strong>
              {item.meta && <span className="muted-2">{item.meta}</span>}
            </div>
            <Link className="btn small" to={item.to}>
              {item.actionLabel}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Guided setup: business → first branch → first ad (spec §16 onboarding).
 *  Renders exactly ONE prominent next action until every step is complete;
 *  hides itself afterwards. Never shown while data is still loading. */
function SetupChecklist({
  steps,
  loading,
  error,
  onRetry,
}: {
  steps: SetupStep[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  if (done === steps.length) return null;

  return (
    <div className="card setup-card">
      <div className="setup-head">
        <h2 className="h-icon"><IconRocket size={20} /> {t.setupTitle}</h2>
        {!loading && !error && (
          <span className="setup-progress">
            {done} / {steps.length}
          </span>
        )}
      </div>

      {loading && (
        <>
          <div className="skeleton skeleton-line w60 mt-10" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line w40" />
        </>
      )}
      {!loading && error && (
        <>
          <p className="callout danger mt-10" role="alert">
            <IconAlert size={14} /> {t.loadError}
          </p>
          <button className="btn mt-10" onClick={onRetry}>
            {t.retry}
          </button>
        </>
      )}

      {!loading && !error && next && (
        <>
          <div className="setup-next">
            <div>
              <span className="muted-2">{t.nextStep}</span>
              <strong>{next.label}</strong>
            </div>
            <Link className="btn primary" to={next.href}>
              {next.cta}
            </Link>
          </div>
          <div className="setup-checklist">
            {steps.map((step, i) => (
              <div key={step.label} className={`check-item${step.done ? " done" : ""}`}>
                <span className="check-num">{step.done ? <IconCheck size={14} /> : i + 1}</span>
                <span className="check-label">
                  {step.label}
                  {step === next && <span className="chip">{t.nextStep}</span>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function OverviewPage() {
  const { t, locale } = useI18n();
  const summaryQuery = useMeSummary(true);
  const businessesQuery = useBusinesses();
  const business = useCurrentBusiness(businessesQuery.data);
  const locationsQuery = useBusinessLocations(business?.id);
  // Unfiltered (all own businesses): attention items and the setup checklist
  // must match what /app/campaigns shows — an owner with several businesses
  // must not miss a rejected campaign on another business's account.
  const campaignsQuery = useCampaigns();
  const ordersQuery = useOrders();
  const lang = locale as "ru" | "uz";
  const summary = summaryQuery.data;

  const attention = attentionItems(
    campaignsQuery.data,
    ordersQuery.data,
    t,
  );

  // A business owns every branch and campaign, so with no business the later
  // steps are definitively incomplete — no need to wait for those queries.
  const hasBusiness = !!businessesQuery.data && businessesQuery.data.length > 0;
  const stepsSetupLoading =
    businessesQuery.isLoading || (hasBusiness && (locationsQuery.isLoading || campaignsQuery.isLoading));
  const stepsSetupError =
    businessesQuery.isError || (hasBusiness && !businessesQuery.isLoading && (locationsQuery.isError || campaignsQuery.isError));

  const steps: SetupStep[] = [
    {
      done: hasBusiness,
      label: t.setupStep1,
      href: "/app/business",
      cta: t.createBusiness,
    },
    {
      done: !hasBusiness ? false : !!locationsQuery.data?.length,
      label: t.setupStep2,
      href: "/app/locations",
      cta: t.addBranch,
    },
    {
      done: !hasBusiness ? false : !!campaignsQuery.data?.length,
      label: t.setupStep3,
      href: "/app/campaigns/new",
      cta: t.newCampaign,
    },
  ];

  const retrySetup = () => {
    businessesQuery.refetch();
    locationsQuery.refetch();
    campaignsQuery.refetch();
  };

  return (
    <section>
      <h2>{t.overview}</h2>

      <SetupChecklist
        steps={steps}
        loading={stepsSetupLoading}
        error={stepsSetupError}
        onRetry={retrySetup}
      />

      {attention.length > 0 && (
        <div className="my-14">
          <AttentionSection items={attention} />
        </div>
      )}
      {attention.length === 0 &&
        campaignsQuery.isSuccess &&
        ordersQuery.isSuccess && (
          <p className="muted all-quiet"><IconCheck size={14} /> {t.allQuiet}</p>
        )}
      {(campaignsQuery.isError || ordersQuery.isError) && (
        <p className="muted-2" role="status">
          <IconAlert size={12} /> {t.partialLoadError}
        </p>
      )}

      {summaryQuery.isLoading && <div className="skeleton skeleton-card" />}
      {summaryQuery.isError && (
        <>
          <p className="callout danger" role="alert">
            <IconAlert size={14} /> {t.loadError}
          </p>
          <button
            className="btn mt-12"
            onClick={() => summaryQuery.refetch()}
          >
            {t.retry}
          </button>
        </>
      )}

      {summary && (
        <>
          <div className="cards">
            <div className="stat-card">
              <span className="icon"><IconEye size={22} /></span>
              <span className="num">{summary.active_placements}</span>
              <span className="muted-2">{t.activePlacements}</span>
            </div>
            <div className="stat-card">
              <span className="icon"><IconClock size={22} /></span>
              <span className="num">{summary.campaigns.submitted + summary.campaigns.under_review}</span>
              <span className="muted-2">{t.pendingReview}</span>
            </div>
            <div className="stat-card">
              <span className="icon"><IconMoney size={22} /></span>
              <span className="num num-money">
                {formatMinor(summary.spend.total, summary.spend.currency, lang)}
              </span>
              <span className="muted-2">{t.totalSpent}</span>
            </div>
            <div className="stat-card">
              <span className="icon"><IconCalendar size={22} /></span>
              <span className="num num-money">
                {formatMinor(summary.spend.month, summary.spend.currency, lang)}
              </span>
              <span className="muted-2">{t.thisMonth}</span>
            </div>
          </div>

          {summary.expiring_soon.length > 0 && (
            <div className="card mt-16">
              <h2 className="h-icon"><IconClock size={20} /> {t.expiringSoon}</h2>
              <ul className="list">
                {summary.expiring_soon.map((p) => (
                  <li key={p.id} className="row-between">
                    <div>
                      <Link to={`/app/campaigns/${p.campaign_id}`}>
                        <strong>{p.headline}</strong>
                      </Link>
                      <div className="muted-2"><IconPin size={12} /> {p.location}</div>
                    </div>
                    <span className="due-soon" title={formatDateTime(p.ends_at, lang)}>
                      {formatRelative(p.ends_at, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="quick-actions">
            <Link to="/app/campaigns/new" className="btn primary">
              + {t.newCampaign}
            </Link>
            <Link to="/app/locations" className="btn">
              + {t.addBranch}
            </Link>
            <Link to="/app/billing" className="btn">
              {t.billing}
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
