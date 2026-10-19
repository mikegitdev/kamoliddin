/** Results panel for the map homepage: results sidebar on desktop, bottom
 *  sheet (collapsed / list / detail) on mobile. Synchronized with the map —
 *  selecting a card focuses the pin and vice versa.
 */
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { plural, useI18n } from "@/shared/i18n";
import { formatDistanceM } from "@/shared/format";
import { useLocationDetail, type ApiSearchAd } from "@/shared/api/queries";
import type { ApiLocationPin } from "@/entities/types";
import type { SheetState } from "./mapSession";
import { IconBack, IconChevronDown, IconChevronUp, IconClose, IconMegaphone } from "@/shared/icons";
import { ContactActions, directionsUrl, FallImg } from "@/shared/ui";
import { PINS_LIMIT } from "@/shared/api/queries";

/* ---------- Result card: a real <button>, keyboard-reachable ---------- */

function ResultCard({
  pin,
  index,
  selected,
  onSelect,
}: {
  pin: ApiLocationPin;
  /** Position in the list; drives the staggered entrance (capped in CSS). */
  index: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { locale } = useI18n();
  const hasAds = pin.active_ads_count > 0;
  return (
    <li style={{ "--i": Math.min(index, 12) } as React.CSSProperties}>
      <button
        type="button"
        className={selected ? "result-card selected" : "result-card"}
        data-id={pin.id}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(pin.id)}
      >
        {/* Monogram mirrors the map: yellow = has ads, gray = none. */}
        <span className={hasAds ? "rc-mono" : "rc-mono idle"} aria-hidden="true">
          {pin.business_name.trim().charAt(0)}
        </span>
        <span className="rc-text">
          <strong>{pin.business_name}</strong>
          <span className="muted-2">
            {pin.name}
            {pin.distance_m != null && <> · {formatDistanceM(pin.distance_m, locale)}</>}
          </span>
        </span>
        {hasAds && (
          <span className="rc-ads">
            <IconMegaphone />
            {pin.active_ads_count}
            <span className="sr-only"> {plural(locale, "ads", pin.active_ads_count)}</span>
          </span>
        )}
      </button>
    </li>
  );
}

/* ---------- Detail view (list item → full location card) ---------- */

function LocationDetailView({
  pin,
  colocGroup,
  onSelect,
  onBack,
  onDismiss,
  backBtnRef,
}: {
  pin: ApiLocationPin | undefined;
  colocGroup: ApiLocationPin[];
  onSelect: (id: string) => void;
  onBack: () => void;
  onDismiss: () => void;
  backBtnRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useI18n();
  const { data: loc, isError, refetch } = useLocationDetail(pin?.id);
  const ads = loc?.active_ads ?? [];
  const dir = loc ? directionsUrl(loc.lon, loc.lat) : undefined;

  return (
    <div className="panel-view detail" role="dialog" aria-label={pin?.business_name ?? t.details}>
      <div className="sheet-head">
        <button className="sheet-back" ref={backBtnRef} onClick={onBack} aria-label={t.backToResults}>
          <IconBack />
        </button>
        <div className="sheet-titles">
          {pin ? (
            <>
              <strong className="sheet-business">{pin.business_name}</strong>
              <span className="muted-2">{pin.name}</span>
            </>
          ) : (
            <div className="skeleton skeleton-line w60" />
          )}
        </div>
        <button className="sheet-close" onClick={onDismiss} aria-label={t.close}>
          <IconClose />
        </button>
      </div>

      {colocGroup.length > 1 && (
        <div className="coloc-picker" role="group" aria-label={t.samePlace}>
          {colocGroup.map((member) => (
            <button
              key={member.id}
              type="button"
              className={member.id === pin?.id ? "coloc-pill selected" : "coloc-pill"}
              aria-pressed={member.id === pin?.id}
              onClick={() => onSelect(member.id)}
            >
              {member.business_name}
            </button>
          ))}
        </div>
      )}

      <div className="sheet-body">
        {isError ? (
          <div className="callout danger" role="alert">
            <span>{t.loadError}</span>
            <button className="btn small" onClick={() => refetch()}>
              {t.retry}
            </button>
          </div>
        ) : !loc ? (
          <>
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line w60" />
            <div className="skeleton skeleton-line w40" />
          </>
        ) : (
          <>
            {ads.length > 0 ? (
              <div className="sheet-ads">
                {ads.slice(0, 2).map((ad, i) => (
                  <Link
                    key={ad.id}
                    to={`/ads/${ad.id}`}
                    className="sheet-ad"
                    state={{ fromLocationId: loc.id }}
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    <FallImg src={ad.banner_url} alt="" className="" />
                    <span className="sheet-ad-text">
                      <strong>{ad.headline}</strong>
                      <span className="muted-2">{ad.business_name}</span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="muted-2">{t.noAdsHere}</p>
            )}
            <p className="sheet-address muted">{loc.address}</p>
            <ContactActions
              directionsUrl={dir}
              phone={loc.phone}
              telegram={loc.telegram}
              whatsapp={loc.whatsapp}
              site={loc.business_site}
              compact
            />
            <div className="row">
              <Link to={`/locations/${loc.id}`} className="btn small">
                {t.details}
              </Link>
              {ads.length > 2 && (
                <Link to={`/locations/${loc.id}`} className="btn subtle small">
                  {t.viewAllAds} ({ads.length})
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Panel shell ---------- */

export interface ResultsPanelProps {
  /** False while the map is kept alive under another page: ignore global keys. */
  active?: boolean;
  state: SheetState;
  onStateChange: (s: SheetState) => void;
  results: ApiLocationPin[];
  campaigns: ApiSearchAd[];
  searchMode: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  selectedPin: string | null;
  colocGroup: ApiLocationPin[];
  onSelect: (id: string) => void;
  onClearSelection: () => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  /** Frame the map on the (relevance-first, possibly off-viewport) search
   *  results so list and map tell the same story. */
  onFitResults?: () => void;
  /** Viewport counts for the collapsed pill / header. */
  locationsCount: number;
  adsCount: number;
}

export function ResultsPanel(props: ResultsPanelProps) {
  const {
    active = true,
    state,
    onStateChange,
    results,
    campaigns,
    searchMode,
    loading,
    error,
    onRetry,
    selectedPin,
    colocGroup,
    onSelect,
    onClearSelection,
    hasFilters,
    onClearFilters,
    onFitResults,
    locationsCount,
    adsCount,
  } = props;
  const { t, locale } = useI18n();
  const listRef = useRef<HTMLUListElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const selected = selectedPin ? results.find((p) => p.id === selectedPin) : undefined;

  // Keep the selected card visible in the list (map pin click → scroll).
  useEffect(() => {
    if (!selectedPin || !listRef.current) return;
    listRef.current
      .querySelector(`button[data-id="${selectedPin}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedPin, results]);

  // Focus the back button when the detail view opens (keyboard + SR users).
  useEffect(() => {
    if (state === "detail") backRef.current?.focus();
  }, [state, selectedPin]);

  // Esc: detail → list, list → collapsed (mobile). Skip while typing.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return;
      if (state === "detail") onStateChange("list");
      else if (state === "list") onStateChange("collapsed");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, state, onStateChange]);

  // Roving arrow-key navigation between result cards.
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const cards = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-id]") ?? [],
    );
    if (cards.length === 0) return;
    e.preventDefault();
    const idx = cards.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (e.key === "ArrowDown") next = idx < 0 ? 0 : Math.min(idx + 1, cards.length - 1);
    else if (e.key === "ArrowUp") next = idx < 0 ? 0 : Math.max(idx - 1, 0);
    else if (e.key === "End") next = cards.length - 1;
    cards[next]?.focus();
  };

  if (state === "collapsed") {
    return (
      <button
        type="button"
        className="results-panel collapsed"
        aria-expanded={false}
        aria-label={t.openList}
        onClick={() => onStateChange("list")}
      >
        <span className="collapsed-grip" aria-hidden="true" />
        <span>
          {locationsCount} {plural(locale, "locations", locationsCount)}
          {" · "}
          {adsCount} {plural(locale, "ads", adsCount)}
        </span>
        <IconChevronUp />
      </button>
    );
  }

  return (
    <section className={state === "detail" ? "results-panel detail" : "results-panel"} data-state={state} aria-label={t.resultsTitle}>
      {state === "detail" ? (
        <LocationDetailView
          key={selectedPin ?? ""} /* remount ⇒ entrance animation per location */
          pin={selected}
          colocGroup={colocGroup}
          onSelect={onSelect}
          onBack={() => onStateChange("list")}
          onDismiss={onClearSelection}
          backBtnRef={backRef}
        />
      ) : (
        <div className="panel-view list-view">
          <div className="panel-head">
            <strong className="panel-title">{t.resultsTitle}</strong>
            <span className="panel-count" aria-live="polite">
              {searchMode
                ? `${t.found}: ${results.length}`
                : `${locationsCount} ${plural(locale, "locations", locationsCount)} · ${adsCount} ${plural(locale, "ads", adsCount)}`}
            </span>
            {searchMode && onFitResults && results.length > 0 && (
              <button
                type="button"
                className="btn subtle small panel-fit"
                onClick={onFitResults}
              >
                {t.showResultsOnMap}
              </button>
            )}
            <button
              type="button"
              className="sheet-close small panel-collapse"
              onClick={() => onStateChange("collapsed")}
              aria-label={t.collapseList}
            >
              <IconChevronDown />
            </button>
          </div>

          <div className="panel-body">
            {error ? (
              <div className="callout danger" role="alert">
                <span>{t.loadError}</span>
                <button className="btn small" onClick={onRetry}>
                  {t.retry}
                </button>
              </div>
            ) : loading ? (
              <>
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line w80" />
                <div className="skeleton skeleton-line w60" />
              </>
            ) : results.length === 0 && campaigns.length === 0 ? (
              <div className="panel-empty">
                <strong>{t.emptyTitle}</strong>
                <span className="muted">{t.emptyHint}</span>
                {hasFilters && (
                  <button className="btn small" onClick={onClearFilters}>
                    {t.clearFilters}
                  </button>
                )}
              </div>
            ) : (
              <>
                <ul className="result-list" ref={listRef} onKeyDown={onListKeyDown}>
                  {results.map((pin, i) => (
                    <ResultCard
                      key={pin.id}
                      pin={pin}
                      index={i}
                      selected={pin.id === selectedPin}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
                {/* Viewport mode caps pins at PINS_LIMIT — a full page means
                    "subset", and the visitor deserves to know that. */}
                {!searchMode && locationsCount >= PINS_LIMIT && results.length >= PINS_LIMIT && (
                  <p className="muted-2 pins-truncated" role="status">{t.pinsTruncated}</p>
                )}
                {campaigns.length > 0 && (
                  <div className="panel-campaigns">
                    <strong className="panel-subtitle">{t.matchingAds}</strong>
                    <ul className="result-list">
                      {campaigns.map((ad) => (
                        <li key={ad.id}>
                          <Link to={`/ads/${ad.id}`} className="result-campaign">
                            <FallImg className="rc-banner" src={ad.banner_url || undefined} alt="" />
                            <span className="rc-text">
                              <strong>{ad.headline}</strong>
                              <span className="muted-2">{ad.business_name}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
