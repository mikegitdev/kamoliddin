import type { MapAdapterOptions } from "./types";

export type { LatLngBounds, MapAdapter, MapAdapterOptions, MapMarker } from "./types";
export { MapLibreAdapter } from "./maplibre/adapter";

/** Map style configuration for the current deploy (spec §10 [E]).
 *
 * Dev defaults (public OSM tiles + MapLibre demo glyphs) are for local
 * development ONLY: public OSM tiles must not serve prod traffic, and the
 * demo glyph host has no SLA. Production sets, in the build env:
 *   VITE_MAP_TILES_URL     licensed raster tile template ({z}/{x}/{y})
 *   VITE_MAP_GLYPHS_URL    glyph PBF template ({fontstack}/{range})
 *   VITE_MAP_ATTRIBUTION   attribution string of the licensed provider
 */
export function mapAdapterOptions(): MapAdapterOptions {
  const tilesUrl = import.meta.env.VITE_MAP_TILES_URL || undefined;
  // Prod without a licensed tile host is a misconfiguration — surface it in
  // the console instead of silently burning the public OSM server (§10 [E]).
  if (import.meta.env.PROD && !tilesUrl) {
    console.warn(
      "VITE_MAP_TILES_URL is not set: the public OSM tile server is dev-only " +
        "and must not serve production traffic (spec §10 [E]).",
    );
  }
  return {
    tilesUrl,
    glyphsUrl: import.meta.env.VITE_MAP_GLYPHS_URL || undefined,
    attribution: import.meta.env.VITE_MAP_ATTRIBUTION || undefined,
  };
}
