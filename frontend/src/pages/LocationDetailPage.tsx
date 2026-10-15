import { useParams } from "react-router-dom";
import { useCategories, useLocationDetail } from "@/shared/api/queries";
import { plural, useI18n } from "@/shared/i18n";
import { reportDialog } from "@/shared/dialog";
import { isOpenNow } from "@/shared/format";
import { IconFlag, IconPin } from "@/shared/icons";
import { MiniMap } from "@/shared/mini-map";
import {
  AdCard,
  BackLink,
  ContactActions,
  HoursList,
  ShareButton,
  StickyContactActions,
  directionsUrl,
} from "@/shared/ui";

/** Public location page, same shell as the ad page: business identity, then
 *  a branch panel (mini map, address/hours, contact actions) and the active
 *  offers. Desktop: offers left, sticky panel right; phones: one column. */
export function LocationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { data: location, isLoading, isError, refetch } = useLocationDetail(id);
  const { data: categories } = useCategories();

  if (isLoading) {
    return (
      <div className="page">
        <nav>
          <BackLink fallbackTo="/" />
        </nav>
        <div className="skeleton skeleton-hero" />
        <div className="mt-18 max-w-420">
          <div className="skeleton skeleton-line w60" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line w40" />
        </div>
      </div>
    );
  }
  if (!location) {
    return (
      <div className="page">
        <div className={isError ? "callout danger" : "callout"} role={isError ? "alert" : "status"}>
          {isError ? (
            <>
              <span>{t.loadError}</span>
              <button className="btn small" onClick={() => refetch()}>
                {t.retry}
              </button>
            </>
          ) : (
            t.notFound
          )}
        </div>
        <p className="mt-14">
          <BackLink fallbackTo="/" fallbackLabel={t.toHomepage} />
        </p>
      </div>
    );
  }

  const ads = location.active_ads;
  const dirUrl = directionsUrl(location.lon, location.lat);
  const category = categories?.find((c) => c.slug === location.category);
  const hasHours = Object.values(location.hours ?? {}).some(Boolean);

  return (
    <div className="page ad-page with-sticky">
      <nav className="row-between">
        <BackLink fallbackTo="/" />
        <div className="row">
          <ShareButton title={location.business_name} />
          <button
            type="button"
            className="btn subtle small"
            aria-label={t.reportTitle}
            title={t.reportTitle}
            onClick={() => void reportDialog({ t, entity: "location", entityId: location.id })}
          >
            <IconFlag size={14} /> <span className="hide-mobile">{t.report}</span>
          </button>
        </div>
      </nav>

      <div className="ad-layout">
        {/* 1. Business identity */}
        <header className="ad-main">
          <div className="ad-business location-head">
            <span className="ad-business-tile" aria-hidden="true">
              {location.business_name.trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h1>{location.business_name}</h1>
              <span className="muted-2">
                {category ? `${locale === "uz" ? category.name_uz : category.name_ru} · ` : ""}
                {location.name}
              </span>
            </div>
          </div>
          <div className="ad-meta">
            {hasHours && (
              <span className={`chip ${isOpenNow(location.hours) ? "green" : "gray"}`}>
                {isOpenNow(location.hours) ? t.hoursOpenNow : t.hoursClosedNow}
              </span>
            )}
            <span className="chip gray">
              {ads.length} {plural(locale, "ads", ads.length)}
            </span>
          </div>
        </header>

        {/* 3. Address / hours / contact — beside the offers on desktop, right
            under the header on phones. */}
        <aside className="ad-aside" aria-labelledby="contacts-heading">
          <div className="ad-aside-head">
            <h2 id="contacts-heading">{t.contacts}</h2>
          </div>
          <div className="card ad-panel">
            <MiniMap
              id={location.id}
              lon={location.lon}
              lat={location.lat}
              label={location.name}
              activeAdsCount={ads.length}
            />
            <div className="ad-panel-body">
              <p className="ad-panel-address">
                <IconPin size={15} />
                <span>{location.address}</span>
              </p>
              <HoursList hours={location.hours} />
              {/* In-content copy hides on phones (StickyContactActions
                  already pins the same actions above the safe area). */}
              <ContactActions
                hiddenOnMobile
                shortDirections
                directionsUrl={dirUrl}
                phone={location.phone}
                telegram={location.telegram}
                whatsapp={location.whatsapp}
                site={location.business_site}
              />
            </div>
          </div>
        </aside>

        {/* 2. Offer: what is being advertised here right now. */}
        <section className="ad-more" aria-labelledby="offers-heading">
          <h2 id="offers-heading">{t.activeAdsTitle}</h2>
          {ads.length > 0 ? (
            <div className="ad-cards">
              {ads.map((ad) => (
                <AdCard key={ad.id} ad={ad} fromLocationId={location.id} hideBusiness />
              ))}
            </div>
          ) : (
            <p className="muted">{t.noAdsHere}</p>
          )}
        </section>
      </div>

      <StickyContactActions
        directionsUrl={dirUrl}
        phone={location.phone}
        telegram={location.telegram}
        whatsapp={location.whatsapp}
        site={location.business_site}
      />
    </div>
  );
}
