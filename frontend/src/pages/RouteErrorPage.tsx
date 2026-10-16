import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { IconAlert } from "@/shared/icons";
import { useI18n } from "@/shared/i18n";
import { NotFoundPage } from "./NotFoundPage";

/** Router errorElement: a render/runtime crash in any route lands here
 *  instead of React Router's default developer screen. */
export function RouteErrorPage() {
  const { t } = useI18n();
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  console.error(error);

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
        {/* Full page load (not <Link>) so the broken in-memory state is dropped. */}
        <a className="btn" href="/">
          {t.toHomepage}
        </a>
      </div>
    </div>
  );
}
