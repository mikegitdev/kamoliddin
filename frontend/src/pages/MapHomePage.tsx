import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LanguageSwitcher, useI18n } from "@/shared/i18n";
import { useCategories, useLocationDetail, useLocationPins, usePublicSearch } from "@/shared/api/queries";
import { MapLibreAdapter, type LatLngBounds, type MapAdapter } from "@/map-adapters";
import { IconClose, IconDirections, IconFilter, IconList, IconPin, IconSearch } from "@/shared/icons";
import { useMediaQuery } from "@/shared/hooks";
import { ResultsPanel } from "@/features/map/ResultsPanel";
import { RecentSearches, rememberSearch } from "@/features/map/RecentSearches";
import { FilterSheet } from "@/features/map/FilterSheet";
import { colocatedGroups, loadSnapshot, saveSnapshot, type SheetState } from "@/features/map/mapSession";
import type { ApiLocationPin } from "@/entities/types";

/** The public pins API rejects bboxes larger than 1 deg² (MAX_BBOX_AREA in
 *  backend/apps/discovery/views.py); stay just under that guard. */
const MAX_BBOX_AREA = 0.98;

/** Zoom used when flying to a selected result. */
const DETAIL_ZOOM = 15.2;

/** Phones: lift the target into the map strip left visible above the detail
 *  bottom sheet (≈60dvh) and below the floating toolbar. */
const MOBILE_FLY_OFFSET: [number, number] = [0, -170];

function boundsArea(b: LatLngBounds): number {
  return (b.east - b.west) * (b.north - b.south);
}

function bboxString(b: LatLngBounds): string {
  return [b.west, b.south, b.east, b.north].map((v) => v.toFixed(4)).join(",");
}

/** Clip a viewport to the API's max bbox area, keeping its center — used for
 *  the first request on screens whose initial view already exceeds the guard. */
function clipToBoundsGuard(b: LatLngBounds): LatLngBounds {
  const area = boundsArea(b);
  if (area <= MAX_BBOX_AREA) return b;
  const scale = Math.sqrt(MAX_BBOX_AREA / area);
  const cx = (b.west + b.east) / 2;
  const cy = (b.south + b.north) / 2;
  const halfW = ((b.east - b.west) * scale) / 2;
  const halfH = ((b.north - b.south) * scale) / 2;
  return {
    west: Math.max(-179.9999, cx - halfW),
    east: Math.min(179.9999, cx + halfW),
    south: Math.max(-89.9999, cy - halfH),
    north: Math.min(89.9999, cy + halfH),
  };
}

/** True when the point sits comfortably inside the viewport (no flight needed). */
function comfortablyVisible(b: LatLngBounds, lon: number, lat: number): boolean {
  const dx = (b.east - b.west) * 0.15;
  const dy = (b.north - b.south) * 0.15;
  return lon > b.west + dx && lon < b.east - dx && lat > b.south + dy && lat < b.north - dy;
}

type GeoState = "idle" | "locating" | "denied";

/** Horizontal offset that keeps the selected pin clear of the results
 *  panel — measured, not hardcoded, so resizes can't hide the pin. The one
 *  place that reads the panel element from the DOM (fitResults shares it). */
const PANEL_SELECTOR = ".results-panel";
function panelWidth(): number {
  const panel = document.querySelector(PANEL_SELECTOR) as HTMLElement | null;
  return panel?.offsetWidth ?? 380;
}
function panelFlyOffset(): [number, number] {
  return [Math.round(panelWidth() * 0.55), 0];
}

export function MapHomePage() {
  const restored = useRef(loadSnapshot()).current;
  const isMobile = useMediaQuery("(max-width: 767px)");
  const { t, locale } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MapAdapter | null>(null);

  const [bbox, setBbox] = useState(restored?.bbox ?? ""); // seeded from the saved session or the real viewport
  const [zoomedOut, setZoomedOut] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  // Filters live in the URL (?category=&q=) so a filtered view can be shared
  // or bookmarked; a URL value wins over the saved session.
  const [category, setCategory] = useState<string>(
    searchParams.get("category") ?? restored?.category ?? "",
  );
  const [query, setQuery] = useState<string>(searchParams.get("q") ?? restored?.query ?? "");
  const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>("collapsed");
  const [camera, setCamera] = useState<{
    center: [number, number];
    zoom: number;
  } | null>(
    restored?.center && restored.zoom != null
      ? { center: restored.center, zoom: restored.zoom }
      : null,
  );
  const [userOrigin, setUserOrigin] = useState<{ lat: number; lon: number } | null>(null);
  const [geoState, setGeoState] = useState<GeoState>("idle");
  const [searchFocused, setSearchFocused] = useState(false);
  // Marker clicks arrive from the adapter created in the init effect below;
  // a ref keeps the callback current without re-initializing the map.
  const selectPinRef = useRef<(id: string, fly?: boolean) => void>(() => {});

  const { data: categories } = useCategories();
  const { data: pins, isLoading, isError, refetch } = useLocationPins({
    bbox,
    category: category || undefined,
    q: debouncedQuery || undefined,
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!containerRef.current) return;
    // Tile source is configuration, not code: dev defaults to public OSM
    // (development ONLY); production MUST set VITE_MAP_TILES_URL to a licensed
    // provider (2GIS tiles or a paid/self-hosted OSM stack) — spec §10 [E],
    // ADR-0004/open-questions gate 2.
    const adapter = new MapLibreAdapter();
    adapter.initialize(containerRef.current, {
      tilesUrl: import.meta.env.VITE_MAP_TILES_URL || undefined,
    });
    // Restore the saved camera (session persistence); otherwise seed the first
    // request from the REAL viewport, clipped to the API's area guard.
    if (restored?.center && restored.zoom != null) {
      adapter.setCenterZoom(restored.center, restored.zoom);
    } else {
      const initial = adapter.getBounds();
      if (initial) setBbox(bboxString(clipToBoundsGuard(initial)));
    }
    // Capture the initial camera even if the visitor never pans (session
    // persistence needs a center/zoom to restore from on the way back).
    // getCenterZoom works before the style finishes loading, unlike onReady.
    const initialCamera = adapter.getCenterZoom();
    if (initialCamera) setCamera({ center: initialCamera.center, zoom: initialCamera.zoom });
    adapter.onViewportChange((bounds: LatLngBounds) => {
      // Viewports larger than the API guard keep the last data instead of
      // failing with a dead error: show a quiet zoom-in hint (footer).
      if (boundsArea(bounds) > MAX_BBOX_AREA) {
        setZoomedOut(true);
        return;
      }
      setZoomedOut(false);
      const cz = adapter.getCenterZoom();
      if (cz) setCamera({ center: cz.center, zoom: cz.zoom });
      setBbox(bboxString(bounds));
    });
    adapter.onMarkerClick((id) => selectPinRef.current(id, false));
    adapter.onReady(() => setMapReady(true));
    adapterRef.current = adapter;
    return () => {
      adapter.destroy();
      adapterRef.current = null;
    };
    // `restored` comes from a ref: stable for the component's lifetime, so the
    // deps below never trigger a re-init.
  }, [restored?.center, restored?.zoom]);

  // --- Global search (relevance-first, distance-ordered; not bbox-bound) ---

  const searchActive = debouncedQuery.length >= 2;
  const searchFilters = useMemo(() => {
    if (!searchActive) return null;
    // Origin for distance ordering (user location or map center, ~1km precision
    // so panning doesn't refetch). Rounded inside the memo for stable identity.
    const o = userOrigin ?? (camera ? { lat: camera.center[1], lon: camera.center[0] } : null);
    return {
      q: debouncedQuery,
      category: category || undefined,
      lat: o ? Math.round(o.lat * 100) / 100 : undefined,
      lon: o ? Math.round(o.lon * 100) / 100 : undefined,
    };
  }, [searchActive, debouncedQuery, category, userOrigin, camera]);
  const {
    data: searchData,
    isLoading: searchLoading,
    isError: searchError,
    refetch: refetchSearch,
  } = usePublicSearch(searchFilters);

  const results = useMemo<ApiLocationPin[]>(
    () => (searchActive ? searchData?.locations ?? [] : pins ?? []),
    [searchActive, searchData, pins],
  );

  /** Lookup for every pin we know about (viewport + search), for fly-to. */
  const pinsById = useMemo(() => {
    const m = new Map<string, ApiLocationPin>();
    for (const p of pins ?? []) m.set(p.id, p);
    for (const p of searchData?.locations ?? []) if (!m.has(p.id)) m.set(p.id, p);
    return m;
  }, [pins, searchData]);

  const groups = useMemo(() => colocatedGroups(results), [results]);
  const colocGroup = useMemo(
    () => groups.find((g) => g.some((p) => p.id === selectedPin)) ?? [],
    [groups, selectedPin],
  );

  // --- Selection: keep map, panel, and list in sync ---

  const selectPin = (id: string, fly = true) => {
    setSelectedPin(id);
    adapterRef.current?.setSelected(id);
    setSheet("detail");
    // A result chosen from a live search is a successful query — remember it.
    if (searchActive) rememberSearch(debouncedQuery);
    const pin = pinsById.get(id);
    const adapter = adapterRef.current;
    if (!pin || !fly || !adapter) return;
    const bounds = adapter.getBounds();
    if (!bounds || !comfortablyVisible(bounds, pin.lon, pin.lat)) {
      // Offset the target so the pin is not hidden behind the panel / sheet.
      const offset: [number, number] = isMobile ? MOBILE_FLY_OFFSET : panelFlyOffset();
      adapter.flyTo([pin.lon, pin.lat], DETAIL_ZOOM, offset);
    }
  };
  selectPinRef.current = selectPin;

  const clearSelection = useCallback(() => {
    setSelectedPin(null);
    adapterRef.current?.setSelected(null);
    setSheet((s) => (s === "detail" ? "collapsed" : s));
  }, []);

  // New search / category ⇒ back to the list view.
  useEffect(() => {
    setSelectedPin(null);
    adapterRef.current?.setSelected(null);
  }, [debouncedQuery, category]);

  // Typing expands the collapsed mobile sheet so results are visible.
  useEffect(() => {
    if (searchActive) setSheet((s) => (s === "collapsed" ? "list" : s));
  }, [searchActive]);

  // Area mode: if the user pans far enough that the selected pin leaves the
  // fetched results, drop the stale selection instead of showing a skeleton.
  useEffect(() => {
    if (selectedPin && !searchActive && pins !== undefined && !pins.some((p) => p.id === selectedPin)) {
      clearSelection();
    }
  }, [selectedPin, searchActive, pins, clearSelection]);

  // Deep link /?pin=<id> ("show on map" from detail pages): select the pin
  // once its data is available, then clean the URL so refresh behaves
  // normally (session snapshot takes over). If the pin sits outside the
  // fetched results, its detail is fetched and the map flies there.
  const deepLinkPin = searchParams.get("pin");
  const { data: deepLinkDetail } = useLocationDetail(
    deepLinkPin && !pinsById.has(deepLinkPin) ? deepLinkPin : undefined,
  );
  useEffect(() => {
    if (!deepLinkPin || !mapReady) return;
    const pin = pinsById.get(deepLinkPin) ?? deepLinkDetail;
    if (!pin || !("lon" in pin)) return;
    // selectPin only flies to pins it knows; deep-linked ones may be outside
    // the fetched viewport, so fly explicitly first.
    adapterRef.current?.flyTo(
      [pin.lon, pin.lat],
      DETAIL_ZOOM,
      isMobile ? MOBILE_FLY_OFFSET : panelFlyOffset(),
    );
    selectPinRef.current(deepLinkPin, false);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("pin");
        return next;
      },
      { replace: true },
    );
  }, [deepLinkPin, mapReady, pinsById, deepLinkDetail, setSearchParams, isMobile]);

  // Mirror the active filters into the URL (replace: no history spam).
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (category) next.set("category", category);
        else next.delete("category");
        if (debouncedQuery) next.set("q", debouncedQuery);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  }, [category, debouncedQuery, setSearchParams]);

  // --- Session persistence (survives /locations/:id and back) ---

  useEffect(() => {
    saveSnapshot({
      query,
      category,
      bbox,
      center: camera?.center ?? null,
      zoom: camera?.zoom ?? null,
    });
  }, [query, category, bbox, camera]);

  // --- Geolocation with a useful permission-denied fallback ---

  const locateMe = () => {
    if (!navigator.geolocation) {
      setGeoState("denied");
      return;
    }
    setGeoState("locating");
    // If the user already denied geolocation, don't re-prompt — show the
    // fallback hint immediately (browsers remember the denial).
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((perm) => perm.state !== "denied")
      .catch(() => true)
      .then((shouldAsk) => {
        if (!shouldAsk) {
          setGeoState("denied");
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setGeoState("idle");
            const { latitude: lat, longitude: lon } = pos.coords;
            setUserOrigin({ lat, lon });
            adapterRef.current?.setUserLocation(lon, lat);
            adapterRef.current?.flyTo([lon, lat], 15.5, isMobile ? [0, -110] : panelFlyOffset());
          },
          () => setGeoState("denied"),
          { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
        );
      });
  };

  const totalAds = pins?.reduce((sum, p) => sum + p.active_ads_count, 0) ?? 0;
  const hasFilters = query.trim() !== "" || category !== "";
  const activeCategory = categories?.find((c) => c.slug === category);
  const categoryName = (c: { name_ru: string; name_uz: string }) =>
    locale === "uz" ? c.name_uz : c.name_ru;
  const clearFilters = () => {
    setQuery("");
    setCategory("");
  };

  /** Frame the map on the current (relevance-ordered) result set, so the
   *  list and the map tell the same story in search mode. */
  const fitResults = () => {
    if (results.length === 0) return;
    const b = results.reduce<LatLngBounds>(
      (acc, p) => ({
        west: Math.min(acc.west, p.lon),
        east: Math.max(acc.east, p.lon),
        south: Math.min(acc.south, p.lat),
        north: Math.max(acc.north, p.lat),
      }),
      { west: results[0].lon, east: results[0].lon, south: results[0].lat, north: results[0].lat },
    );
    const panelWidthPx = panelWidth();
    adapterRef.current?.fitBounds(
      b,
      isMobile
        ? { top: 90, bottom: 340, left: 24, right: 24 }
        : { top: 90, bottom: 90, left: panelWidthPx + 32, right: 48 },
    );
  };

  // --- Pins on the map: clustered (adapter groups at low zoom) ---
  // Must run after init AND whenever the visible result set changes (viewport
  // pan, search, category). Without it the map is just tiles.
  useEffect(() => {
    if (!mapReady) return;
    adapterRef.current?.setClusters(
      results.map((p) => ({
        id: p.id,
        lng: p.lon,
        lat: p.lat,
        activeAdsCount: p.active_ads_count,
        label: p.business_name,
      })),
    );
  }, [mapReady, results]);

  // Keep the selection halo in sync when the pin set changes (e.g. new search).
  useEffect(() => {
    if (selectedPin) adapterRef.current?.setSelected(selectedPin);
  }, [results, selectedPin]);

  const panelState: SheetState = selectedPin
    ? sheet
    : sheet === "detail"
      ? "list"
      : sheet;

  return (
    <div className="map-page">
      <div className="map-container" ref={containerRef} role="region" aria-label={t.appTitle} />

      {/* Stays mounted so it can fade out once the map is ready. */}
      {!isError && (
        <div className={mapReady ? "map-loading done" : "map-loading"} aria-hidden="true">
          <span className="map-loading-badge">
            <IconPin />
          </span>
          <span className="map-loading-shadow" />
        </div>
      )}

      <header className="map-header">
        <Link to="/" className="brand" aria-label={t.appTitle}>
          <span className="logo">
            <IconPin />
          </span>
          <span className="brand-text">
            {t.appTitle}
            <small>{t.tagline}</small>
          </span>
        </Link>

        <div className="header-utils">
          <Link className="btn primary" to="/login">
            {t.forBusiness}
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      {/* Floating toolbar over the map (Joymee-style): list toggle + search,
          category chips underneath. */}
      <div className="map-toolbar">
        <div className="toolbar-row">
          <button
            type="button"
            className={`list-toggle${panelState !== "collapsed" ? " active" : ""}`}
            aria-expanded={panelState !== "collapsed"}
            aria-label={panelState === "collapsed" ? t.openList : t.collapseList}
            onClick={() => setSheet((s) => (s === "collapsed" ? "list" : "collapsed"))}
          >
            <IconList />
            <span>{t.listToggle}</span>
            {/* Keyed by value: a changed count re-mounts and "pops". */}
            <span className="list-toggle-count" key={searchActive ? results.length : pins?.length ?? 0}>
              {searchActive ? results.length : pins?.length ?? 0}
            </span>
          </button>
          <div className="controls">
            <span
              className={`search-wrap${
                query.trim() !== "" && (searchActive ? searchLoading : isLoading) ? " busy" : ""
              }`}
            >
              <IconSearch />
              <input
                type="search"
                placeholder={t.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={(e) => {
                  // Clicking a recent item keeps focus inside the wrapper.
                  if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) {
                    setSearchFocused(false);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query.trim().length >= 2) {
                    rememberSearch(query);
                    setSearchFocused(false);
                  }
                }}
                aria-label={t.search}
              />
              <RecentSearches
                open={searchFocused && query.trim() === ""}
                recentLabel={t.recentSearches}
                closeLabel={t.close}
                onPick={(q) => {
                  setQuery(q);
                  setSearchFocused(false);
                }}
                onClose={() => setSearchFocused(false)}
              />
            </span>
            {hasFilters && (
              <button className="btn small" onClick={clearFilters}>
                <IconClose />
                {t.clearFilters}
              </button>
            )}
          </div>
        </div>

        {/* Category filter: [Filters] opens the full list; the active
            category sits pinned right after it (never scrolled off-screen)
            with a × to remove it; the rest stay as one-tap quick picks. */}
        <div className="category-chips" role="group" aria-label={t.categoryLabel}>
          <button
            type="button"
            className={`cat-chip filter-chip${category ? " has-active" : ""}`}
            aria-haspopup="dialog"
            onClick={() => setFiltersOpen(true)}
          >
            <IconFilter size={16} />
            {t.filters}
            {category && <span className="filter-chip-count">1</span>}
          </button>
          {activeCategory && (
            <button
              type="button"
              className="cat-chip active removable"
              aria-label={`${t.removeFilter}: ${categoryName(activeCategory)}`}
              onClick={() => setCategory("")}
            >
              {categoryName(activeCategory)}
              <IconClose size={14} />
            </button>
          )}
          {categories
            ?.filter((c) => c.slug !== category)
            .map((c, i) => (
              <button
                key={c.slug}
                type="button"
                style={{ "--i": i + 1 } as React.CSSProperties}
                className="cat-chip"
                onClick={() => setCategory(c.slug)}
              >
                {categoryName(c)}
              </button>
            ))}
        </div>
      </div>

      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        categories={categories ?? []}
        category={category}
        onCategoryChange={setCategory}
        resultCount={(searchActive ? searchLoading : isLoading) ? undefined : results.length}
      />

      <ResultsPanel
        state={panelState}
        onStateChange={setSheet}
        results={results}
        campaigns={searchActive ? searchData?.campaigns ?? [] : []}
        searchMode={searchActive}
        loading={searchActive ? searchLoading : isLoading}
        error={searchActive ? searchError : isError}
        onRetry={searchActive ? refetchSearch : refetch}
        selectedPin={selectedPin}
        colocGroup={colocGroup}
        onSelect={(id) => selectPin(id)}
        onClearSelection={clearSelection}
        hasFilters={hasFilters}
        onClearFilters={clearFilters}
        onFitResults={searchActive ? fitResults : undefined}
        locationsCount={pins?.length ?? 0}
        adsCount={totalAds}
      />

      <button
        type="button"
        className={geoState === "locating" ? "geo-button busy" : "geo-button"}
        onClick={locateMe}
        disabled={geoState === "locating"}
        aria-label={geoState === "locating" ? t.geoLocating : t.myLocation}
        title={t.myLocation}
      >
        <IconDirections />
        <span>{t.nearMe}</span>
      </button>

      {geoState === "denied" && (
        <div className="geo-hint" role="alert">
          <div className="geo-hint-text">
            <strong>{t.geoDeniedTitle}</strong>
            <span className="muted">{t.geoDeniedHint}</span>
          </div>
          <button className="sheet-close small" onClick={() => setGeoState("idle")} aria-label={t.close}>
            <IconClose />
          </button>
        </div>
      )}

      {!isLoading && !isError && !searchActive && pins?.length === 0 && (
        <div className="map-empty" role="status">
          <strong>{t.emptyTitle}</strong>
          <span className="muted">{t.emptyHint}</span>
          {hasFilters && (
            <button className="btn small" onClick={clearFilters}>
              {t.clearFilters}
            </button>
          )}
        </div>
      )}

      {zoomedOut && !isError && (
        <div className="map-banner" role="status">
          <div className="map-banner-text">
            <strong>{t.zoomOutTitle}</strong>
            <span className="muted">{t.zoomOutHint}</span>
          </div>
          <button className="btn small" onClick={() => adapterRef.current?.zoomIn()}>
            {t.zoomInAction}
          </button>
        </div>
      )}

      <footer className="map-footer">
        {/* Counts live in the results panel / collapsed pill — the footer
            carries status and the pin legend only; the zoomed-out state is
            the .map-banner's job (no duplicated hint here). */}
        {isError ? (
          <span className="row" role="alert">
            <span className="error-text">{t.loadError}</span>
            <button className="btn small" onClick={() => refetch()}>
              {t.retry}
            </button>
          </span>
        ) : isLoading && !searchActive ? (
          <span className="muted">{t.loading}</span>
        ) : null}
        <span className="legend">
          <span>
            <span className="dot dot-active" /> {t.legendWithAds}
          </span>
          <span>
            <span className="dot dot-idle" /> {t.legendNoAds}
          </span>
        </span>
      </footer>
    </div>
  );
}
