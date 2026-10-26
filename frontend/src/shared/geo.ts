/** Geographic helpers for the public map UI (client-side estimates only —
 *  the spec has no routing backend, §10 ranks by geographic distance). */

export interface LatLng {
  lat: number;
  lon: number;
}

/** Great-circle (haversine) distance in meters. */
export function distanceM(from: LatLng, to: LatLng): number {
  const R = 6_371_000;
  const p1 = (from.lat * Math.PI) / 180;
  const p2 = (to.lat * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((to.lon - from.lon) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* Approximate travel times from straight-line meters: route detour factor ×
 * typical Tashkent city speeds. Always presented with a "≈" — these are
 * proximity hints, not routed directions (2GIS/Yandex links do that). */
const SPEEDS = {
  walk: { detour: 1.25, kmh: 4.5 },
  car: { detour: 1.4, kmh: 24 },
} as const;

/** Estimated travel time in minutes for the given mode. */
export function travelMinutes(meters: number, mode: keyof typeof SPEEDS): number {
  const { detour, kmh } = SPEEDS[mode];
  return ((meters * detour) / 1000 / kmh) * 60;
}
