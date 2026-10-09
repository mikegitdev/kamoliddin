import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, ApiError } from "@/shared/api/client";
import type { ApiActiveAd } from "@/entities/types";
import { useI18n } from "@/shared/i18n";

/** Active-only ad details; expired/unapproved returns 404 (spec §14). */
export function PublicAdPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const routerLocation = useLocation();
  const fromLocationId = (routerLocation.state as { fromLocationId?: string } | null)
    ?.fromLocationId;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["public-ad", id],
    queryFn: () => api<ApiActiveAd>(`/api/v1/public/campaigns/${id}`),
    retry: false,
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 230, borderRadius: 18 }} />
        <div style={{ marginTop: 18, maxWidth: 420 }}>
          <div className="skeleton skeleton-line w60" />
          <div className="skeleton skeleton-line" />
        </div>
      </div>
    );
  }

  if (!data) {
    const unavailable = isError && error instanceof ApiError && error.status === 404;
    return (
      <div className="page">
        <div className={unavailable ? "callout" : "callout danger"} role={unavailable ? "status" : "alert"}>
          <span>{unavailable ? `🔒 ${t.adUnavailable}` : t.loadError}</span>
          {!unavailable && (
            <button className="btn small" onClick={() => refetch()}>
              {t.retry}
            </button>
          )}
        </div>
        <p style={{ marginTop: 14 }}>
          <Link className="btn" to="/">
            {t.toHomepage}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <nav className="row-between">
        <Link to="/">
          ← {t.toHomepage}
        </Link>
        {fromLocationId && (
          <Link to={`/locations/${fromLocationId}`}>{t.details}</Link>
        )}
      </nav>
      <div className="ad-banner">
        <img src={data.banner_url} alt={data.headline} />
      </div>
      <h1>{data.headline}</h1>
      <p className="muted" style={{ marginBottom: 12 }}>
        {data.business_name}
      </p>
      <p style={{ fontSize: "1.02rem", lineHeight: 1.6, whiteSpace: "pre-line" }}>
        {data.body}
      </p>
    </div>
  );
}
