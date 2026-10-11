import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LanguageSwitcher, plural, useI18n } from "@/shared/i18n";
import { useCategories, useLocationPins, usePublicSearch } from "@/shared/api/queries";
import { MapLibreAdapter, type LatLngBounds, type MapAdapter } from "@/map-adapters";
import { IconClose, IconLocate, IconPin, IconSearch } from "@/shared/icons";
import { useMediaQuery } from "@/shared/hooks";
import { ResultsPanel } from "@/features/map/ResultsPanel";
import { colocatedGroups, loadSnapshot, saveSnapshot, type SheetState } from "@/features/map/mapSession";
import type { ApiLocationPin } from "@/entities/types";

/** The public pins API rejects bboxes larger than 1 deg² (MAX_BBOX_AREA in
 *  backend/apps/discovery/views.py); stay just under that guard. */
const MAX_BBOX_AREA = 0.98;

/** Zoom used when flying to a selected result. */
const DETAIL_ZOOM = 15.2;

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

export function MapHomePage() {
  const restored = useRef(loadSnapshot()).current;
  const isMobile = useMediaQuery("(max-width: 767px)");
  const { t, locale } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MapAdapter | null>(null);

  const [bbox, setBbox] = useState(restored?.bbox ?? ""); // seeded from the saved session or the real viewport
  const [zoomedOut, setZoomedOut] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [category, setCategory] = useState<string>(restored?.category ?? "");
  const [query, setQuery] = useState<string>(restored?.query ?? "");
  const [debouncedQuery, setDebouncedQuery] = useState((restored?.query ?? "").trim());
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
    const adapter = new MapLibreAdapter();
    adapter.initialize(containerRef.current);
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
    const pin = pinsById.get(id);
    const adapter = adapterRef.current;
    if (!pin || !fly || !adapter) return;
    const bounds = adapter.getBounds();
    if (!bounds || !comfortablyVisible(bounds, pin.lon, pin.lat)) {
      // Offset the target so the pin is not hidden behind the panel / sheet.
      const offset: [number, number] = isMobile ? [0, -110] : [190, 0];
      adapter.flyTo([pin.lon, pin.lat], DETAIL_ZOOM, offset);
    }
  };
  selectPinRef.current = selectPin;

  const clearSelection = useCallback(() => {
    setSelectedPin(null);
    adapterRef.current?.setSelected(null);
    setSheet((s) => (s === "detail" ? "list" : s));
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
            adapterRef.current?.flyTo([lon, lat], 15.5, isMobile ? [0, -110] : [190, 0]);
          },
          () => setGeoState("denied"),
          { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
        );
      });
  };

  const totalAds = pins?.reduce((sum, p) => sum + p.active_ads_count, 0) ?? 0;
  const hasFilters = query.trim() !== "" || category !== "";
  const clearFilters = () => {
    setQuery("");
    setCategory("");
  };

  const panelState: SheetState = selectedPin
    ? sheet
    : sheet === "detail"
      ? "list"
      : sheet;
  const effectivePanelState: SheetState =
    !isMobile && panelState === "collapsed" ? "list" : panelState;

  return (
    <div className="map-page">
      <div className="map-container" ref={containerRef} aria-label={t.appTitle} />

      {!mapReady && !isError && (
        <div className="map-loading" aria-hidden="true">
          <span className="map-loading-badge">
            <IconPin />
          </span>
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

        <div className="controls">
          <span className="search-wrap">
            <IconSearch />
            <input
              type="search"
              placeholder={t.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t.search}
            />
          </span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label={t.allCategories}
          >
            <option value="">{t.allCategories}</option>
            {categories?.map((c) => (
              <option key={c.slug} value={c.slug}>
                {locale === "uz" ? c.name_uz : c.name_ru}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button className="btn small" onClick={clearFilters}>
              <IconClose />
              {t.clearFilters}
            </button>
          )}
        </div>

        <div className="header-utils">
          <Link className="btn primary" to="/login">
            {t.forBusiness}
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      <ResultsPanel
        state={effectivePanelState}
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
        <IconLocate />
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

      <footer className="map-footer">
        {isError ? (
          <span className="row" role="alert">
            <span className="error-text">{t.loadError}</span>
            <button className="btn small" onClick={() => refetch()}>
              {t.retry}
            </button>
          </span>
        ) : zoomedOut ? (
          <span className="muted">{t.zoomInHint}</span>
        ) : isLoading ? (
          <span className="muted">{t.loading}</span>
        ) : (
          <span>
            {pins?.length ?? 0} {plural(locale, "locations", pins?.length ?? 0)}
            {" · "}
            {totalAds} {plural(locale, "ads", totalAds)}
          </span>
        )}
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
