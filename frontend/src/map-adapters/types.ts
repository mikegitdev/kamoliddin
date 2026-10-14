/** Map provider adapter interface (spec §10).
 *
 * 2GIS MapGL adapter is primary once licensing is confirmed ([E] gate);
 * MapLibre + OSM raster tiles is the dev fallback implementation
 * (map-adapters/maplibre). The rest of the app only talks to this interface.
 */

export interface MapMarker {
  id: string;
  lng: number;
  lat: number;
  /** Number of ACTIVE public ads at this location (cluster label semantics,
   * spec §10: never ambiguously mix "locations" and "ads" counts). */
  activeAdsCount: number;
  /** Callout text for locations with active ads (e.g. the business name). */
  label?: string;
}

export interface LatLngBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface MapAdapter {
  initialize(container: HTMLElement): void;
  /** Current viewport bounds; null before initialize(). */
  getBounds(): LatLngBounds | null;
  /** Current camera position; null before initialize(). */
  getCenterZoom(): { center: [number, number]; zoom: number } | null;
  /** Instantly move the camera (session restore). */
  setCenterZoom(center: [number, number], zoom: number): void;
  /** Smoothly move the camera; `offset` shifts the target in screen pixels
   *  so the pin stays visible beside the results panel / bottom sheet. */
  flyTo(center: [number, number], zoom?: number, offset?: [number, number]): void;
  /** Fit the viewport to bounds (search-result framing), with asymmetric
   *  padding so the results panel / sheet does not cover the pins. */
  fitBounds(
    bounds: LatLngBounds,
    padding?: Partial<Record<"top" | "bottom" | "left" | "right", number>>,
  ): void;
  /** Zoom in one step (zoom-out hint action). */
  zoomIn(): void;
  /** Highlight the selected pin on the map; null clears the highlight. */
  setSelected(id: string | null): void;
  /** Show the user-location dot at the given coordinates. */
  setUserLocation(lng: number, lat: number): void;
  /** Fires once when the map style has loaded — the earliest point where
   *  setMarkers/setClusters can add their layers. */
  onReady(cb: () => void): void;
  /** Plain markers, no clustering. */
  setMarkers(markers: MapMarker[]): void;
  /** Clustered markers when zoomed out (spec §10). */
  setClusters(markers: MapMarker[]): void;
  /** Single draggable placement pin (branch picker, spec §13). Null clears
   *  it; onChange fires when the user finishes dragging the pin. */
  setPickMarker(
    point: { lng: number; lat: number } | null,
    onChange?: (lng: number, lat: number) => void,
  ): void;
  onViewportChange(cb: (bounds: LatLngBounds, zoom: number) => void): void;
  onMarkerClick(cb: (id: string) => void): void;
  /** Click-to-pick coordinates (branch map picker, spec §13 /app/locations). */
  onMapClick(cb: (lng: number, lat: number) => void): void;
  destroy(): void;
}
