import { Link } from "react-router-dom";
import { IconPin } from "@/shared/icons";
import { useI18n } from "@/shared/i18n";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="page notfound-page">
      <span className="notfound-logo" aria-hidden="true">
        <IconPin size={40} />
      </span>
      <h1>404</h1>
      <p className="muted">{t.notFound}</p>
      <div className="row justify-center mt-16">
        <Link className="btn primary" to="/">
          {t.toHomepage}
        </Link>
        <Link className="btn" to="/login">
          {t.forBusiness}
        </Link>
      </div>
    </div>
  );
}
