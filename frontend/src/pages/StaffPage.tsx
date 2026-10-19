import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api/client";
import { useSession } from "@/shared/api/queries";
import { LanguageSwitcher, useI18n } from "@/shared/i18n";
import { formatPhone } from "@/shared/format";
import { toast } from "@/shared/toast";
import { IconShield, IconUser } from "@/shared/icons";
import { AdminOverviewTab } from "./staff/AdminOverviewTab";
import { QueueTab } from "./staff/QueueTab";
import { ReportsTab } from "./staff/ReportsTab";
import { CampaignsTab } from "./staff/CampaignsTab";
import { RefundsTab } from "./staff/RefundsTab";
import { OrdersTab } from "./staff/OrdersTab";
import { LogsTab } from "./staff/LogsTab";
import { UsersTab } from "./staff/UsersTab";
import { BusinessesTab } from "./staff/BusinessesTab";
import { PlacementsTab } from "./staff/PlacementsTab";
import { GrantsTab } from "./staff/GrantsTab";
import { SettingsTab } from "./staff/SettingsTab";

type Tab =
  | "overview"
  | "queue"
  | "reports"
  | "campaigns"
  | "placements"
  | "businesses"
  | "users"
  | "refunds"
  | "orders"
  | "grants"
  | "logs"
  | "settings";

const TABS: Tab[] = [
  "overview", "queue", "reports", "campaigns", "placements", "businesses",
  "users", "refunds", "orders", "grants", "logs", "settings",
];

/** Staff control room (spec §12, extended): moderation queue, every account,
 *  business, branch, placement and log, refunds, grants, settings.
 *  Shell only — each tab lives in ./staff/*; drill-downs travel in the URL. */
export function StaffPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user, isLoading, isError, error: sessionError } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "overview";
  const setTab = (next: Tab) => setSearchParams(next === "overview" ? {} : { tab: next }, { replace: true });
  const [error, setError] = useState<string | null>(null);

  const logout = async () => {
    try {
      await api("/api/v1/auth/csrf").catch(() => {});
      await api("/api/v1/auth/logout", { method: "POST", json: {} });
      queryClient.clear(); // no staff data may outlive the session
      navigate("/");
    } catch {
      // A failed logout must not strand staff silently — surface it.
      toast.error(t.logoutError);
    }
  };

  const tabLabel: Record<Tab, string> = {
    overview: t.adminOverview,
    queue: t.reviewQueue,
    reports: t.reportsTab,
    campaigns: t.campaignsTab,
    placements: t.placementsTab,
    businesses: t.businessesTab,
    users: t.usersTab,
    refunds: t.refunds,
    orders: t.ordersTab,
    grants: t.grants,
    logs: t.logsTab,
    settings: t.settings,
  };

  const consoleChrome = (content: React.ReactNode) => (
    <div className="page app-page">
      <header className="app-header">
        <Link to="/" className="brand">
          <span className="logo">
            <IconShield size={30} />
          </span>
          <span>
            {t.staffTitle}
            <small>{t.appTitle}</small>
          </span>
        </Link>
        <div className="row">
          <span className="app-user">
            <span className="avatar">
              <IconUser size={14} />
            </span>
            {formatPhone(user?.phone_e164)}
          </span>
          <LanguageSwitcher />
          <button className="btn small" onClick={() => void logout()}>
            {t.logout}
          </button>
        </div>
      </header>

      <nav className="app-nav" aria-label={t.staffTitle}>
        {TABS.map((k) => (
          <button
            key={k}
            className={tab === k ? "active" : ""}
            aria-current={tab === k ? "page" : undefined}
            onClick={() => setTab(k)}
          >
            {tabLabel[k]}
          </button>
        ))}
      </nav>

      {error && (
        <p className="error dismissible" role="alert">
          {error}
          <button className="sheet-close small" onClick={() => setError(null)} aria-label={t.close}>
            ×
          </button>
        </p>
      )}
      <main>{content}</main>
    </div>
  );

  if (isLoading) {
    return consoleChrome(<div className="skeleton skeleton-card" />);
  }
  if (!user) {
    // Transient failure ≠ logged out: only a CONFIRMED 401/403 redirects
    // (useSession has retry:false, so a network blip must not kick staff out).
    const authRejected =
      sessionError instanceof ApiError && [401, 403].includes(sessionError.status);
    if (isError && !authRejected) {
      return consoleChrome(
        <section>
          <p className="callout danger" role="alert">
            {t.loadError}
          </p>
        </section>,
      );
    }
    return <Navigate to="/login" replace />;
  }
  if (!user.is_staff) {
    return consoleChrome(
      <section className="card no-access">
        <h2>
          <IconShield size={22} /> {t.noAccess}
        </h2>
        <p className="muted">{t.noAccessHint}</p>
        <div className="row">
          <Link className="btn" to="/app">
            {t.cabinet}
          </Link>
          <button className="btn" onClick={() => void logout()}>
            {t.logout}
          </button>
        </div>
      </section>,
    );
  }

  return consoleChrome(
    <>
      {tab === "overview" && <AdminOverviewTab />}
      {tab === "queue" && <QueueTab onError={setError} locale={locale} />}
      {tab === "reports" && <ReportsTab onError={setError} locale={locale} />}
      {tab === "campaigns" && <CampaignsTab locale={locale} />}
      {tab === "placements" && <PlacementsTab locale={locale} />}
      {tab === "businesses" && <BusinessesTab locale={locale} />}
      {tab === "users" && <UsersTab locale={locale} />}
      {tab === "refunds" && <RefundsTab onError={setError} locale={locale} />}
      {tab === "orders" && <OrdersTab locale={locale} />}
      {tab === "grants" && <GrantsTab onError={setError} />}
      {tab === "logs" && <LogsTab locale={locale} />}
      {tab === "settings" && <SettingsTab onError={setError} />}
    </>,
  );
}
