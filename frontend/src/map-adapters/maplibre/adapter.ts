import maplibregl from "maplibre-gl";
import type { LatLngBounds, MapAdapter, MapMarker } from "../types";

/** Mirrors --brand / --ink in index.css (map paint can't read CSS vars). */
const BRAND = "#fee02a";
const INK = "#000000";
/** Bold-ish glyphs with a Cyrillic range on the demo glyph host. */
const LABEL_FONT = ["Open Sans Semibold"];
const LABEL_MAX = 22;

/** Badge ring radius (logical px) at full size. Every location with ads gets
 *  the SAME badge size — no paid prominence (spec §10 [C]: no paid ranking
 *  boost in MVP); the count is shown as a number, not as size. The image is
 *  drawn at this size and only ever scaled down (stays crisp). */
const BADGE_R = 18;

/** Density factor: few badges on screen ⇒ full size; a crowded view shrinks
 *  every badge equally so they don't pile up. */
const DENSITY_FEW = 12;
const DENSITY_MANY = 120;
const DENSITY_MIN = 0.8;

function densityFactor(badges: number): number {
  const t = Math.min(1, Math.max(0, (badges - DENSITY_FEW) / (DENSITY_MANY - DENSITY_FEW)));
  return Math.round((1 - t * (1 - DENSITY_MIN)) * 100) / 100;
}

/** Badge, count, name-tag and gray-dot sizes for one density factor. */
function badgeSizing(density: number) {
  return {
    iconSize: density,
    // Count text ≈ 44% of the ring diameter.
    textSize: Math.round(BADGE_R * 2 * 0.44 * density * 10) / 10,
    // Name tag rides on the badge's top edge: text bottom at -(ring radius +
    // 2px ring/shadow + 15px fit padding & pointer), in ems of the 13px label.
    calloutOffset: [0, -(BADGE_R * density + 2 + 15) / 13] as [number, number],
    // No-ads gray dot: 5px in crowded views, up to 7px when sparse.
    dotRadius: 5 + ((density - DENSITY_MIN) / (1 - DENSITY_MIN)) * 2,
  };
}

function calloutLabel(m: MapMarker): string {
  const name = m.label ?? "";
  return name.length > LABEL_MAX ? `${name.slice(0, LABEL_MAX - 1).trimEnd()}…` : name;
}

function canvas2x(w: number, h: number): CanvasRenderingContext2D {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  return ctx;
}

/** Name tag (rounded pill + short pointer + soft shadow), drawn at 2x and
 *  registered as a stretchable image so icon-text-fit wraps any label.
 *  Image pixels: 112×81; body (8,8)–(104,68); pointer tip at y=80. The
 *  image ends at the tip (no shadow room below) so its collision box never
 *  reaches the badge's count. */
function calloutImage(fill: string): { image: ImageData; options: Partial<maplibregl.StyleImageMetadata> } {
  const ctx = canvas2x(112, 81);
  ctx.shadowColor = "rgba(0,0,0,0.18)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(8, 8, 96, 60, 20);
  ctx.moveTo(46, 66);
  ctx.lineTo(56, 80);
  ctx.lineTo(66, 66);
  ctx.closePath();
  ctx.fill();
  return {
    image: ctx.getImageData(0, 0, 112, 81),
    options: {
      pixelRatio: 2,
      stretchX: [
        [28, 42],
        [70, 84],
      ],
      stretchY: [[28, 48]],
      content: [26, 18, 86, 58],
    },
  };
}

/** Ad-count badge: filled circle, white ring, soft shadow — drawn at 2x at
 *  full size (ring radius BADGE_R); icon-size scales it down when crowded. */
function badgeImage(fill: string): { image: ImageData; options: Partial<maplibregl.StyleImageMetadata> } {
  const r = BADGE_R * 2; // device px
  const size = r * 2 + 16; // + shadow room
  const c = size / 2;
  const ctx = canvas2x(size, size);
  ctx.shadowColor = "rgba(0,0,0,0.22)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(c, c - 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(c, c - 2, r * 0.81, 0, Math.PI * 2);
  ctx.fill();
  return { image: ctx.getImageData(0, 0, size, size), options: { pixelRatio: 2 } };
}

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
  private pulseFrame = 0;
  /** Density factor the badge layers were last sized for (see badgeSizing). */
  private density = 1;

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
        {
          id: "tiles",
          type: "raster",
          source: "tiles",
          // Bright, lightly muted base map: real colors stay readable while
          // the brand callouts still pop.
          paint: {
            "raster-saturation": -0.2,
            "raster-brightness-min": 0.04,
            "raster-fade-duration": 200,
          },
        },
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
    // Ready = style loaded. Callers wait for this before the first
    // setClusters/setMarkers, so it must not depend on pins existing.
    this.map.once("load", () => this.markReady());
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
    const match: maplibregl.FilterSpecification = ["==", ["get", "id"], id ?? "__none__"];
    const withAds: maplibregl.FilterSpecification = [">", ["get", "active_ads_count"], 0];
    map.setFilter("pin-selected", ["all", match, ["!", withAds]]);
    map.setFilter("pin-pulse", match);
    map.setFilter("pin-badge-selected", ["all", match, withAds]);
    map.setFilter("pin-callout-selected", ["all", match, withAds, ["!=", ["get", "label"], ""]]);
    this.runPulse(id !== null);
  }

  /** Sonar ring under the selected pin: one circle layer, repainted per frame
   *  only while something is selected (idle map = zero work). */
  private runPulse(on: boolean): void {
    cancelAnimationFrame(this.pulseFrame);
    this.pulseFrame = 0;
    const map = this.map;
    if (!on || !map || !map.getLayer("pin-pulse")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    const tick = (now: number) => {
      if (!this.map) return;
      const t = ((now - start) % 1600) / 1600; // 0→1 every 1.6s
      const ease = 1 - (1 - t) ** 3;
      this.map.setPaintProperty("pin-pulse", "circle-radius", 16 + ease * 26);
      this.map.setPaintProperty("pin-pulse", "circle-opacity", 0.55 * (1 - t));
      this.pulseFrame = requestAnimationFrame(tick);
    };
    this.pulseFrame = requestAnimationFrame(tick);
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

    const density = densityFactor(markers.filter((m) => m.activeAdsCount > 0).length);
    const sizing = badgeSizing(density);

    if (map.getSource("pins")) {
      (map.getSource("pins") as maplibregl.GeoJSONSource).setData(this.toGeoJson(markers));
      // Re-layout only when the density bucket actually moved.
      if (density !== this.density) {
        this.density = density;
        for (const id of ["pin-badges", "pin-badge-selected"]) {
          map.setLayoutProperty(id, "icon-size", sizing.iconSize);
          map.setLayoutProperty(id, "text-size", sizing.textSize);
        }
        for (const id of ["pin-callouts", "pin-callout-selected"]) {
          map.setLayoutProperty(id, "text-offset", sizing.calloutOffset);
        }
        map.setPaintProperty("pins", "circle-radius", sizing.dotRadius);
      }
      this.markReady();
      return;
    }
    this.density = density;

    map.addSource("pins", {
      type: "geojson",
      data: this.toGeoJson(markers),
      cluster,
      // Cluster only at overview zooms; from city zoom on, every location is
      // a dot and label collision (not clustering) thins the callouts.
      clusterRadius: 50,
      clusterMaxZoom: 10,
    });
    // Soft drop shadow under clusters (blurred circle, no extra images).
    map.addLayer({
      id: "clusters-shadow",
      type: "circle",
      source: "pins",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#000000",
        "circle-opacity": 0.18,
        "circle-blur": 0.6,
        "circle-translate": [0, 2],
        "circle-radius": ["step", ["get", "point_count"], 24, 10, 28, 25, 34],
      },
    });
    map.addLayer({
      id: "clusters",
      type: "circle",
      source: "pins",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": BRAND,
        "circle-radius": ["step", ["get", "point_count"], 18, 10, 22, 25, 28],
        "circle-stroke-width": 4,
        "circle-stroke-color": "#ffffff",
      },
    });
    map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: "pins",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count"],
        "text-font": LABEL_FONT,
        "text-size": 14,
      },
      paint: { "text-color": INK },
    });
    if (!map.hasImage("callout")) {
      const images = {
        callout: calloutImage("#ffffff"),
        "callout-selected": calloutImage(INK),
        badge: badgeImage(BRAND),
        "badge-selected": badgeImage(INK),
      };
      for (const [name, { image, options }] of Object.entries(images)) map.addImage(name, image, options);
    }
    const single: maplibregl.FilterSpecification = ["!", ["has", "point_count"]];
    const withAds: maplibregl.FilterSpecification = [">", ["get", "active_ads_count"], 0];
    // Name tag sits above the badge. icon-text-fit wraps the (lifted) text,
    // so the text offset alone positions it: 4px fit padding + 11px pointer
    // puts the tip exactly on the badge's top edge (follows the density size).
    const calloutLayout = {
      "icon-text-fit": "both",
      "icon-text-fit-padding": [5, 9, 4, 9],
      "text-anchor": "bottom",
      "text-offset": sizing.calloutOffset,
      "text-field": ["get", "label"],
      "text-font": LABEL_FONT,
      "text-size": 13,
      "text-max-width": 20,
    } satisfies maplibregl.SymbolLayerSpecification["layout"];
    // Badge = icon + count. Always placed (allow-overlap) so EVERY location
    // with ads stays visible. Only the count text takes part in collision
    // (the icon's box includes shadow room and would block its own tag):
    // name tags avoid covering any badge's number instead of hiding it.
    const badgeLayout = {
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "text-allow-overlap": true,
      "text-field": ["to-string", ["get", "active_ads_count"]],
      "text-font": LABEL_FONT,
      // One size for every badge; shrinks only when the view is crowded.
      "icon-size": sizing.iconSize,
      "text-size": sizing.textSize,
      "text-offset": [0, 0.02],
      // Overlapping badges: the higher-priority (lower rank) one draws on
      // top — allow-overlap layers paint higher sort keys last.
      "symbol-sort-key": ["-", 0, ["get", "rank"]],
    } satisfies maplibregl.SymbolLayerSpecification["layout"];
    // Selection pulse + halo (under everything): kept in sync with setSelected().
    map.addLayer({
      id: "pin-pulse",
      type: "circle",
      source: "pins",
      filter: ["==", ["get", "id"], "__none__"],
      paint: {
        "circle-color": BRAND,
        "circle-radius": 11,
        "circle-opacity": 0,
        // Driven per frame by runPulse(); style transitions would lag it.
        "circle-radius-transition": { duration: 0 },
        "circle-opacity-transition": { duration: 0 },
      },
    });
    // Locations without ads: a quiet gray dot (selected → black dot).
    map.addLayer({
      id: "pins",
      type: "circle",
      source: "pins",
      filter: ["all", single, ["!", withAds]],
      paint: {
        "circle-color": "#8a8a8a",
        "circle-radius": sizing.dotRadius,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
    map.addLayer({
      id: "pin-selected",
      type: "circle",
      source: "pins",
      filter: ["==", ["get", "id"], "__none__"],
      paint: {
        "circle-color": INK,
        "circle-radius": 7,
        "circle-stroke-width": 2.5,
        "circle-stroke-color": "#ffffff",
      },
    });
    // Symbol layers higher in the stack are placed first. Order (top → down):
    // selected tag, selected badge, badges, name tags — so badges claim their
    // space before any name tag, and tags yield to them.
    // Name tags (spec §10: count = CURRENTLY active ads, shown on the badge).
    map.addLayer({
      id: "pin-callouts",
      type: "symbol",
      source: "pins",
      filter: ["all", single, withAds, ["!=", ["get", "label"], ""]],
      minzoom: 11,
      layout: {
        ...calloutLayout,
        "icon-image": "callout",
        // Colliding tags: lower rank is placed first and keeps its tag.
        // Neutral by contract (relevance / distance), never ad volume.
        "symbol-sort-key": ["get", "rank"],
      },
      paint: { "text-color": INK },
    });
    map.addLayer({
      id: "pin-badges",
      type: "symbol",
      source: "pins",
      filter: ["all", single, withAds],
      layout: { ...badgeLayout, "icon-image": "badge" },
      paint: { "text-color": INK },
    });
    map.addLayer({
      id: "pin-badge-selected",
      type: "symbol",
      source: "pins",
      filter: ["==", ["get", "id"], "__none__"],
      layout: { ...badgeLayout, "icon-image": "badge-selected" },
      paint: { "text-color": BRAND },
    });
    map.addLayer({
      id: "pin-callout-selected",
      type: "symbol",
      source: "pins",
      filter: ["==", ["get", "id"], "__none__"],
      layout: {
        ...calloutLayout,
        "icon-image": "callout-selected",
        "icon-allow-overlap": true,
        "text-allow-overlap": true,
      },
      paint: { "text-color": BRAND },
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

    for (const layer of ["pins", "pin-badges", "pin-badge-selected", "pin-callouts", "pin-callout-selected"]) {
      map.on("click", layer, (e) => {
        const feature = e.features?.[0];
        const id = feature?.properties?.id as string | undefined;
        if (id && this.clickCallback) this.clickCallback(id);
      });
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }

    this.markReady();
  }

  private toGeoJson(markers: MapMarker[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
    return {
      type: "FeatureCollection",
      features: markers.map((m, i) => ({
        type: "Feature",
        id: m.id,
        geometry: { type: "Point", coordinates: [m.lng, m.lat] },
        properties: {
          id: m.id,
          active_ads_count: m.activeAdsCount,
          label: calloutLabel(m),
          // Display priority = caller's order (0 = highest); see MapAdapter.
          rank: i,
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
    cancelAnimationFrame(this.pulseFrame);
    this.pickMarker?.remove();
    this.pickMarker = null;
    this.userMarker?.remove();
    this.userMarker = null;
    this.map?.remove();
    this.map = null;
  }
}
