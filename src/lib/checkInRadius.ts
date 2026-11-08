// Is a worker close enough to a project to check in? Real geographic distance between the phone's GPS fix and the project's
// coordinates, against the project's saved check-in distance. Pure, no network. The database repeats the same rule
// (supabase/updates/052) so a modified app can't skip it.

export interface LatLng { latitude: number; longitude: number }
export interface GpsFix extends LatLng { accuracy?: number }

/** A fix this vague can't be trusted either way, so the worker is asked to try again instead of being let in or turned away. */
export const MAX_USABLE_ACCURACY_M = 100;
/** The phone is allowed to be this much closer than it says (GPS error), never more. */
export const MAX_ACCURACY_ALLOWANCE_M = 75;

const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle (haversine) distance in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export const validCoords = (c?: Partial<LatLng> | null): c is LatLng =>
  !!c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)
  && Math.abs(c.latitude as number) <= 90 && Math.abs(c.longitude as number) <= 180
  // (0, 0) is "no location" in practice, not a real job site.
  && !(c.latitude === 0 && c.longitude === 0);

export type CheckInVerdict =
  | { ok: true; distance: number }
  | { ok: false; reason: 'no_site' | 'bad_gps' | 'inaccurate' | 'too_far'; distance?: number; accuracy?: number; radius: number };

/** A saved check-in distance of 0 means "Anywhere": the worker does not have to be at the property. */
export const ANYWHERE_RADIUS_M = 0;

export function evaluateCheckIn(input: { gps: GpsFix; site: Partial<LatLng> | null | undefined; radiusM: number }): CheckInVerdict {
  const { gps, site, radiusM } = input;
  if (radiusM <= ANYWHERE_RADIUS_M) return { ok: true, distance: 0 };
  if (!validCoords(site)) return { ok: false, reason: 'no_site', radius: radiusM };
  if (!validCoords(gps)) return { ok: false, reason: 'bad_gps', radius: radiusM };
  const accuracy = Math.max(0, gps.accuracy ?? 0);
  const distance = Math.round(haversineMeters(gps, site));
  if (accuracy > MAX_USABLE_ACCURACY_M) return { ok: false, reason: 'inaccurate', distance, accuracy: Math.round(accuracy), radius: radiusM };
  if (distance - Math.min(accuracy, MAX_ACCURACY_ALLOWANCE_M) <= radiusM) return { ok: true, distance };
  return { ok: false, reason: 'too_far', distance, accuracy: Math.round(accuracy), radius: radiusM };
}

/** What to tell the worker. `distanceText` and `radiusText` are already formatted ("1,200 ft"). */
export function checkInRefusal(
  v: Extract<CheckInVerdict, { ok: false }>,
  jobName: string,
  distanceText: (m: number) => string,
): { title: string; message: string; retry: boolean } {
  switch (v.reason) {
    case 'too_far':
      return {
        title: 'You are too far from this project to check in',
        message: `You are about ${distanceText(v.distance ?? 0)} from ${jobName}. You need to be within ${distanceText(v.radius)} to check in.`,
        retry: false,
      };
    case 'inaccurate':
      return {
        title: 'Your location is not accurate enough',
        message: `Your phone's GPS is only accurate to about ${distanceText(v.accuracy ?? 0)} right now. Step into the open, wait a moment, then try again.`,
        retry: true,
      };
    case 'bad_gps':
      return { title: "Can't read your location", message: "Your phone gave an unusable location. Wait a moment, then try again.", retry: true };
    case 'no_site':
    default:
      return {
        title: "This project's location isn't set",
        message: `We can't find ${jobName}'s address on the map, so your location can't be checked. Ask the office to fix the project address, then try again.`,
        retry: false,
      };
  }
}
