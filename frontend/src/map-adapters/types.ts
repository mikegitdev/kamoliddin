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
}

export interface LatLngBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface MapAdapter {
  initialize(container: HTMLElement): void;
  setCenterZoom(center: [number, number], zoom: number): void;
  /** Plain markers, no clustering. */
  setMarkers(markers: MapMarker[]): void;
  /** Clustered markers when zoomed out (spec §10). */
  setClusters(markers: MapMarker[]): void;
  onViewportChange(cb: (bounds: LatLngBounds, zoom: number) => void): void;
  onMarkerClick(cb: (id: string) => void): void;
  /** Click-to-pick coordinates (branch map picker, spec §13 /app/locations). */
  onMapClick(cb: (lng: number, lat: number) => void): void;
  destroy(): void;
}
