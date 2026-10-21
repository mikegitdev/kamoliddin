import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { MapLibreAdapter, mapAdapterOptions } from "@/map-adapters";
import { IconPin } from "@/shared/icons";
import { useI18n } from "@/shared/i18n";

/** Non-interactive map preview of one branch (ad and location pages); the
 *  whole tile links to the full map. Pointer events are off on the canvas so page scrolling
 *  over it never turns into a map zoom. Pin count is the branch's real
 *  active-ads count (spec §10) — callers pass a known count, never a guess. */
export function MiniMap({
  id,
  lon,
  lat,
  label,
  activeAdsCount,
}: {
  id: string;
  lon: number;
  lat: number;
  label: string;
  activeAdsCount: number;
}) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const adapter = new MapLibreAdapter();
    adapter.initialize(containerRef.current, mapAdapterOptions());
    // Center slightly north so the pin and its name tag sit below the
    // "show on map" pill in the top-left corner.
    adapter.setCenterZoom([lon, lat + 0.0004], 15);
    adapter.setMarkers([{ id, lng: lon, lat, activeAdsCount, label }]);
    return () => adapter.destroy();
  }, [id, lon, lat, label, activeAdsCount]);

  return (
    <Link to={`/?pin=${id}`} className="ad-minimap" aria-label={t.miniMapLabel}>
      <div ref={containerRef} aria-hidden="true" />
      <span className="ad-minimap-cta">
        <IconPin size={14} /> {t.showOnMap}
      </span>
    </Link>
  );
}
