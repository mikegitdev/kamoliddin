import { IconAlert } from "@/shared/icons";
import type { Dict } from "@/shared/i18n/ru";

/** Shared crash fallback: full reload + homepage escape hatch (the full page
 *  load — not <Link> — drops the broken in-memory state). Used by the router
 *  errorElement and the root ErrorBoundary. */
export function CrashScreen({ t }: { t: Dict }) {
  return (
    <div className="page notfound-page" role="alert">
      <span className="notfound-logo" aria-hidden="true">
        <IconAlert size={40} />
      </span>
      <h1>{t.crashTitle}</h1>
      <p className="muted">{t.crashHint}</p>
      <div className="row justify-center mt-16">
        <button className="btn primary" onClick={() => window.location.reload()}>
          {t.reload}
        </button>
        <a className="btn" href="/">
          {t.toHomepage}
        </a>
      </div>
    </div>
  );
}
