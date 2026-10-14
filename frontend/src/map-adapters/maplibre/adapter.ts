import maplibregl from "maplibre-gl";
import type { LatLngBounds, MapAdapter, MapMarker } from "../types";

/**
 * MapLibre fallback adapter (spec §10 [E]): dev tile source is the public OSM
 * server — fine for local development ONLY. Production requires a licensed
 * tile provider (2GIS tiles or a self-hosted/bought OSM stack); swap the style
 * URL via the tilesUrl option then.
 */
export class MapLibreAdapter implements MapAdapter {
  private map: maplibregl.Map | null = null;
  private clickCallback: ((id: string) => void) | null = null;
  private pickMarker: maplibregl.Marker | null = null;
  private pickChangeCallback: ((lng: number, lat: number) => void) | null = null;
  private ready = false;
  private readyCallbacks: (() => void)[] = [];
  private selectedId: string | null = null;
  private userMarker: maplibregl.Marker | null = null;

  // Style with a raster tile source; replaced by a licensed provider in prod.
  private static style(tilesUrl: string): maplibregl.StyleSpecification {
    return {
      version: 8,
      // Demo glyphs host for the count labels (swap with the licensed provider).
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        tiles: {
          type: "raster",
          tiles: [tilesUrl],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors",
        },
      },
      layers: [
        { id: "background", type: "background", paint: { "background-color": "#e8ecef" } },
        { id: "tiles", type: "raster", source: "tiles" },
      ],
    };
  }

  initialize(container: HTMLElement, opts?: { tilesUrl?: string }): void {
    const tilesUrl = opts?.tilesUrl ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
    this.map = new maplibregl.Map({
      container,
      style: MapLibreAdapter.style(tilesUrl),
      center: [69.2401, 41.2995], // Tashkent
      zoom: 11.5,
    });
    this.map.addControl(new maplibregl.NavigationControl(), "top-right");
  }

  getBounds(): LatLngBounds | null {
    const b = this.map?.getBounds();
    if (!b) return null;
    return {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
  }

  getCenterZoom(): { center: [number, number]; zoom: number } | null {
    if (!this.map) return null;
    const c = this.map.getCenter();
    return { center: [c.lng, c.lat], zoom: this.map.getZoom() };
  }

  onReady(cb: () => void): void {
    if (this.ready) cb();
    else this.readyCallbacks.push(cb);
  }

  private markReady(): void {
    if (this.ready) return;
    this.ready = true;
    for (const cb of this.readyCallbacks) cb();
    this.readyCallbacks = [];
  }

  setCenterZoom(center: [number, number], zoom: number): void {
    this.map?.jumpTo({ center, zoom });
  }

  flyTo(center: [number, number], zoom?: number, offset?: [number, number]): void {
    if (!this.map) return;
    const target = this.map.getZoom();
    this.map.flyTo({
      center,
      zoom: zoom !== undefined ? Math.max(zoom, target) : target,
      offset: offset ?? [0, 0],
      essential: true,
    });
  }

  fitBounds(bounds: LatLngBounds, padding?: Partial<Record<"top" | "bottom" | "left" | "right", number>>): void {
    if (!this.map) return;
    this.map.fitBounds(
      [
        [bounds.west, bounds.south],
        [bounds.east, bounds.north],
      ],
      { padding: { top: 60, bottom: 60, left: 60, right: 60, ...padding }, maxZoom: 15.5, essential: true },
    );
  }

  zoomIn(): void {
    this.map?.zoomIn({ duration: 400 });
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    const map = this.map;
    if (!map || !map.getLayer("pin-selected")) return;
    map.setFilter("pin-selected", id ? ["==", ["get", "id"], id] : ["==", ["get", "id"], "__none__"]);
  }

  setUserLocation(lng: number, lat: number): void {
    const map = this.map;
    if (!map) return;
    if (!this.userMarker) {
      const el = document.createElement("div");
      el.className = "user-dot";
      el.setAttribute("role", "img");
      this.userMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      return;
    }
    this.userMarker.setLngLat([lng, lat]);
  }

  setPickMarker(
    point: { lng: number; lat: number } | null,
    onChange?: (lng: number, lat: number) => void,
  ): void {
    if (!point) {
      this.pickChangeCallback = null;
      this.pickMarker?.remove();
      this.pickMarker = null;
      return;
    }
    this.pickChangeCallback = onChange ?? null;
    if (this.pickMarker) {
      this.pickMarker.setLngLat([point.lng, point.lat]);
      return;
    }
    const el = document.createElement("div");
    el.className = "pick-marker";
    el.setAttribute("role", "img");
    this.pickMarker = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat([point.lng, point.lat])
      .addTo(this.map!);
    this.pickMarker.on("dragend", () => {
      const ll = this.pickMarker!.getLngLat();
      this.pickChangeCallback?.(ll.lng, ll.lat);
    });
  }

  setMarkers(markers: MapMarker[]): void {
    this.setData(markers, false);
  }

  setClusters(markers: MapMarker[]): void {
    this.setData(markers, true);
  }

  private setData(markers: MapMarker[], cluster: boolean): void {
    const map = this.map;
    if (!map || !map.isStyleLoaded()) {
      // Retry once the style is ready (first paint).
      map?.once("load", () => this.setData(markers, cluster));
      return;
    }

    if (map.getSource("pins")) {
      (map.getSource("pins") as maplibregl.GeoJSONSource).setData(this.toGeoJson(markers));
      this.markReady();
      return;
    }

    map.addSource("pins", {
      type: "geojson",
      data: this.toGeoJson(markers),
      cluster,
      clusterRadius: 60,
      clusterMaxZoom: 13,
    });
    map.addLayer({
      id: "clusters",
      type: "circle",
      source: "pins",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#2563eb",
        "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 25, 24],
        "circle-opacity": 0.85,
      },
    });
    map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: "pins",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count"],
        "text-size": 13,
      },
      paint: { "text-color": "#ffffff" },
    });
    map.addLayer({
      id: "pins",
      type: "circle",
      source: "pins",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": [
          "case",
          [">", ["get", "active_ads_count"], 0],
          "#f97316",
          "#94a3b8",
        ],
        "circle-radius": 8,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
    // Active-ads count on individual pins (spec §10: pin = location,
    // count = CURRENTLY active ads there — distinct from cluster counts).
    map.addLayer({
      id: "pin-count",
      type: "symbol",
      source: "pins",
      filter: ["all", ["!", ["has", "point_count"]], [">", ["get", "active_ads_count"], 0]],
      layout: {
        "text-field": ["get", "active_ads_count"],
        "text-size": 11,
        "text-offset": [0, -1.4],
        "text-anchor": "bottom",
      },
      paint: {
        "text-color": "#7c2d12",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    });
    // Selection halo: kept in sync with setSelected() (results panel sync).
    map.addLayer({
      id: "pin-selected",
      type: "circle",
      source: "pins",
      filter: ["==", ["get", "id"], "__none__"],
      paint: {
        "circle-color": "#2563eb",
        "circle-opacity": 0.22,
        "circle-radius": 18,
        "circle-stroke-width": 2.5,
        "circle-stroke-color": "#2563eb",
      },
    });
    if (this.selectedId) this.setSelected(this.selectedId);

    // Cluster tap/keyboard drill-down: expand to member locations.
    map.on("click", "clusters", (e) => {
      const feature = e.features?.[0];
      const clusterId = feature?.properties?.cluster_id as number | undefined;
      if (clusterId === undefined || !feature) return;
      const source = map.getSource("pins") as maplibregl.GeoJSONSource;
      source
        .getClusterExpansionZoom(clusterId)
        .then((zoom) => {
          const coords = (feature.geometry as GeoJSON.Point).coordinates;
          map.easeTo({ center: [coords[0], coords[1]], zoom: zoom + 0.2 });
        })
        .catch(() => undefined);
    });
    map.on("mouseenter", "clusters", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "clusters", () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("click", "pins", (e) => {
      const feature = e.features?.[0];
      const id = feature?.properties?.id as string | undefined;
      if (id && this.clickCallback) this.clickCallback(id);
    });
    map.on("mouseenter", "pins", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "pins", () => {
      map.getCanvas().style.cursor = "";
    });

    this.markReady();
  }

  private toGeoJson(markers: MapMarker[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
    return {
      type: "FeatureCollection",
      features: markers.map((m) => ({
        type: "Feature",
        id: m.id,
        geometry: { type: "Point", coordinates: [m.lng, m.lat] },
        properties: {
          id: m.id,
          active_ads_count: m.activeAdsCount,
        },
      })),
    };
  }

  onViewportChange(cb: (bounds: LatLngBounds, zoom: number) => void): void {
    this.map?.on("moveend", () => {
      const b = this.map!.getBounds();
      cb(
        { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
        this.map!.getZoom(),
      );
    });
  }

  onMarkerClick(cb: (id: string) => void): void {
    this.clickCallback = cb;
  }

  onMapClick(cb: (lng: number, lat: number) => void): void {
    this.map?.on("click", (e) => {
      cb(e.lngLat.lng, e.lngLat.lat);
    });
  }

  destroy(): void {
    this.pickMarker?.remove();
    this.pickMarker = null;
    this.userMarker?.remove();
    this.userMarker = null;
    this.map?.remove();
    this.map = null;
  }
}
