import { Link } from "react-router-dom";
import { useI18n } from "@/shared/i18n";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="page">
      <h1>404</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        {t.notFound}
      </p>
      <Link className="btn primary" to="/">
        {t.toHomepage}
      </Link>
    </div>
  );
}
