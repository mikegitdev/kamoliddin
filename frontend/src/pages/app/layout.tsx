import { useEffect } from "react";
import { Link, Navigate, NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "@/shared/api/client";
import { useSession } from "@/shared/api/queries";
import { LanguageSwitcher, useI18n } from "@/shared/i18n";

/** Advertiser cabinet layout (/app). Auth-gated by the session query. */
export function AdvertiserLayout() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data: user, isLoading } = useSession();

  // Make sure the csrftoken cookie exists for authenticated mutations (spec §9).
  useEffect(() => {
    if (user) api("/api/v1/auth/csrf").catch(() => {});
  }, [user]);

  if (!isLoading && !user) {
    return <Navigate to="/login" replace />;
  }

  const logout = async () => {
    // Refresh the CSRF cookie first: a cleared cookie + live session would
    // otherwise 403 the logout forever (found via browser testing).
    await api("/api/v1/auth/csrf").catch(() => {});
    await api("/api/v1/auth/logout", { method: "POST", json: {} });
    navigate("/");
  };

  const initials = (user?.phone_e164 ?? "??").slice(-2);

  return (
    <div className="page app-page">
      <header className="app-header">
        <Link to="/" className="brand" style={{ boxShadow: "var(--shadow-xs)" }}>
          <span className="logo" aria-hidden="true">
            📍
          </span>
          <span className="brand-text">
            {t.cabinet}
            <small>{t.appTitle}</small>
          </span>
        </Link>
        <div className="row">
          <span className="app-user">
            <span className="avatar">{initials}</span>
            {user?.phone_e164 ?? "…"}
          </span>
          <LanguageSwitcher />
          <button className="btn small" onClick={logout}>
            {t.logout}
          </button>
        </div>
      </header>
      <nav className="app-nav" aria-label={t.cabinet}>
        <NavLink to="/app" end>
          {t.overview}
        </NavLink>
        <NavLink to="/app/business">{t.business}</NavLink>
        <NavLink to="/app/locations">{t.branches}</NavLink>
        <NavLink to="/app/campaigns">{t.campaigns}</NavLink>
        <NavLink to="/app/billing">{t.billing}</NavLink>
        {user?.is_staff && <NavLink to="/staff">{t.staffTitle}</NavLink>}
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
