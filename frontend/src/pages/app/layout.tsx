import { useEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/shared/api/client";
import { useSession } from "@/shared/api/queries";
import { LanguageSwitcher, useI18n } from "@/shared/i18n";
import { formatPhone } from "@/shared/format";
import { toast } from "@/shared/toast";
import { IconAlert, IconExternal, IconPin, IconUser } from "@/shared/icons";
import { BusinessSwitcher, useSelectedBusinessId } from "@/features/advertiser/currentBusiness";

/** Advertiser cabinet layout (/app). Auth-gated by the session query. */
export function AdvertiserLayout() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user, isLoading, isError, error, refetch } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedBusinessId = useSelectedBusinessId();

  // Close the user menu on any click outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // Make sure the csrftoken cookie exists for authenticated mutations (spec §9).
  useEffect(() => {
    if (user) api("/api/v1/auth/csrf").catch(() => {});
  }, [user]);

  if (!isLoading && !user) {
    // Only a CONFIRMED auth rejection means "not logged in". A transient
    // network/server failure must not log the user out (useSession has
    // retry: false), so it gets an explicit error + retry instead.
    if (isError && !(error instanceof ApiError && [401, 403].includes(error.status))) {
      return (
        <div className="page app-page">
          <header className="app-header">
            <Link to="/" className="brand">
              <span className="logo" aria-hidden="true">
                <IconPin size={30} />
              </span>
              <span className="brand-text">
                {t.cabinet}
                <small>{t.appTitle}</small>
              </span>
            </Link>
          </header>
          <main>
            <section>
              <h2>{t.cabinet}</h2>
              <p className="callout danger" role="alert">
                <IconAlert size={14} /> {t.loadError}
              </p>
              <button className="btn mt-12" onClick={() => refetch()}>
                {t.retry}
              </button>
            </section>
          </main>
        </div>
      );
    }
    return <Navigate to="/login" replace />;
  }

  const logout = async () => {
    // Refresh the CSRF cookie first: a cleared cookie + live session would
    // otherwise 403 the logout forever (found via browser testing).
    try {
      await api("/api/v1/auth/csrf").catch(() => {});
      await api("/api/v1/auth/logout", { method: "POST", json: {} });
      // Drop every cached response: the next person to log in on this
      // browser must not see this account's session, businesses or orders.
      queryClient.clear();
      navigate("/");
    } catch {
      // A failed logout must not strand the user silently — surface it.
      toast.error(t.logoutError);
    }
  };

  return (
    <div className="page app-page">
      <header className="app-header">
        {/* The block labeled "cabinet" must stay inside the cabinet — the
            public map is reachable via the explicit "to map" action. */}
        <Link to="/app" className="brand">
          <span className="logo" aria-hidden="true">
            <IconPin size={30} />
          </span>
          <span className="brand-text">
            {t.cabinet}
            <small>{t.appTitle}</small>
          </span>
        </Link>
        <div className="row">
          <BusinessSwitcher />
          <Link to="/" className="btn subtle small hide-mobile">
            <IconExternal size={12} /> {t.toMap}
          </Link>
          <LanguageSwitcher />
          <div className="user-menu" ref={menuRef}>
            <button
              type="button"
              className={`app-user menu-trigger${menuOpen ? " open" : ""}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span className="avatar" aria-hidden="true">
                <IconUser size={14} />
              </span>
              <span className="hide-mobile">{formatPhone(user?.phone_e164)}</span>
            </button>
            {menuOpen && (
              <div className="user-menu-pop" role="menu">
                <span className="user-menu-phone muted-2">{formatPhone(user?.phone_e164)}</span>
                <Link to="/app/account" role="menuitem" onClick={() => setMenuOpen(false)}>
                  {t.account}
                </Link>
                <button type="button" role="menuitem" onClick={logout}>
                  {t.logout}
                </button>
              </div>
            )}
          </div>
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
        <NavLink to="/app/account">{t.account}</NavLink>
        {/* Phones hide the header's "to map" action; this keeps the map one tap away. */}
        <Link to="/" className="nav-map-mobile">
          <IconExternal size={12} /> {t.toMap}
        </Link>
        {user?.is_staff && (
          <NavLink to="/staff" className="nav-staff">
            {t.staffTitle}
          </NavLink>
        )}
      </nav>
      <main>
        {/* Switching business remounts the page: no form state of the
            previous business may carry over. */}
        <Outlet key={selectedBusinessId ?? "default"} />
      </main>
    </div>
  );
}
