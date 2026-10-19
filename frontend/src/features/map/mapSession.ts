/** Map homepage session: snapshot persistence + co-located pin grouping.
 *
 *  The snapshot survives in-place navigation to /locations/:id and back
 *  (plus a hard reload via sessionStorage), preserving the visitor's search,
 *  filters, and map position when they return from a details page.
 */
import type { ApiLocationPin } from "@/entities/types";

export type SheetState = "collapsed" | "list" | "detail";

export interface MapSnapshot {
  query: string;
  category: string;
  bbox: string;
  center: [number, number] | null;
  zoom: number | null;
  /** Open pin + sheet, so Back from an ad/location page lands on the same card. */
  selectedPin?: string | null;
  sheet?: SheetState;
}

const STORAGE_KEY = "map-home-snapshot";

let snapshot: MapSnapshot | null = null;

export function loadSnapshot(): MapSnapshot | null {
  if (snapshot) return snapshot;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MapSnapshot;
    if (
      typeof parsed.query === "string" &&
      typeof parsed.category === "string" &&
      typeof parsed.bbox === "string"
    ) {
      snapshot = parsed;
      return snapshot;
    }
  } catch {
    // Corrupted or unavailable storage: fall back to a fresh session.
  }
  return null;
}

export function saveSnapshot(next: MapSnapshot): void {
  snapshot = next;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private-mode Safari can throw on sessionStorage writes; in-memory copy
    // above still covers plain back-navigation within the session.
  }
}

/** Pins within this distance are treated as "sharing the same location". */
export const COLOCATION_RADIUS_M = 30;

/** Greedy proximity grouping of pins (n <= 200, O(n²) is fine). Businesses in
 *  one building can share (near-)identical coordinates, which visually stack
 *  into a single clickable dot — the chooser lists every member. */
export function colocatedGroups(pins: ApiLocationPin[]): ApiLocationPin[][] {
  const groups: { cx: number; cy: number; members: ApiLocationPin[] }[] = [];
  for (const p of pins) {
    const cosLat = Math.cos((p.lat * Math.PI) / 180);
    const mPerDegLat = 111_320;
    const mPerDegLon = 111_320 * cosLat;
    let target = groups.find(
      (g) =>
        Math.hypot(
          (g.cx - p.lon) * mPerDegLon,
          (g.cy - p.lat) * mPerDegLat,
        ) <= COLOCATION_RADIUS_M,
    );
    if (!target) {
      target = { cx: p.lon, cy: p.lat, members: [] };
      groups.push(target);
    }
    target.members.push(p);
  }
  return groups.map((g) => g.members);
}
