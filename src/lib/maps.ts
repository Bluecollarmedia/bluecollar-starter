import { Alert, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import { formatAddress, type AddressParts } from './address';

export interface Place extends Partial<AddressParts> {
  latitude?: number;
  longitude?: number;
}

export type NavApp = 'apple_maps' | 'google_maps' | 'waze' | 'default' | string | undefined;

export type VerifyResult =
  | { status: 'found'; latitude: number; longitude: number }
  | { status: 'not_found' }
  | { status: 'unavailable'; reason: string };

/**
 * Looks the address up with the phone's own map service (Apple Maps on iPhone,
 * Google on Android). Free, no API key. Not available on the web.
 */
export async function verifyAddress(a: AddressParts): Promise<VerifyResult> {
  if (Platform.OS === 'web') return { status: 'unavailable', reason: 'Address check works in the phone app.' };
  try {
    if (Platform.OS === 'android') {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return { status: 'unavailable', reason: 'Location permission is needed to check addresses.' };
    }
    const results = await Location.geocodeAsync(formatAddress(a));
    const hit = results[0];
    if (!hit) return { status: 'not_found' };
    return { status: 'found', latitude: hit.latitude, longitude: hit.longitude };
  } catch (err: any) {
    // The geocoder throws when it has no match on some platforms.
    const msg = String(err?.message ?? '');
    if (/not found|no result|kCLErrorDomain error 8|geocode/i.test(msg)) return { status: 'not_found' };
    return { status: 'unavailable', reason: msg || 'Address check failed.' };
  }
}

/** Opens turn-by-turn directions, using the exact map spot when the address was verified. */
export function openDirections(place: Place, navApp?: NavApp) {
  const label = formatAddress(place);
  const hasCoords = place.latitude != null && place.longitude != null;
  const dest = encodeURIComponent(hasCoords ? `${place.latitude},${place.longitude}` : label);
  let url: string;
  switch (navApp) {
    case 'google_maps':
      url = `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
      break;
    case 'waze':
      url = hasCoords
        ? `https://waze.com/ul?ll=${dest}&navigate=yes`
        : `https://waze.com/ul?q=${dest}&navigate=yes`;
      break;
    case 'apple_maps':
      url = `https://maps.apple.com/?daddr=${dest}`;
      break;
    default:
      url = Platform.OS === 'ios'
        ? `https://maps.apple.com/?daddr=${dest}`
        : `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
  }
  if (Platform.OS === 'web') {
    window.open(url, '_blank');
    return;
  }
  // https links hand off to the installed app (Google Maps, Waze, Apple
  // Maps) via universal links, or fall back to the browser if it's missing.
  Linking.openURL(url).catch(() => Alert.alert('Could not open maps', label));
}

/** Shows the spot on a map (no directions), to eyeball a verified address. */
export function previewOnMap(place: Place) {
  const label = encodeURIComponent(formatAddress(place));
  const ll = `${place.latitude},${place.longitude}`;
  const url = Platform.OS === 'ios'
    ? `https://maps.apple.com/?ll=${ll}&q=${label}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ll)}`;
  if (Platform.OS === 'web') window.open(url, '_blank');
  else Linking.openURL(url).catch(() => {});
}

type Coords = { latitude: number; longitude: number };

/** Addresses already looked up this session. */
const coordsCache = new Map<string, Coords | null>();

/** The place's map spot: its saved coordinates, or a (cached) lookup of its address. Null if not found. */
export async function findCoords(place: Place): Promise<Coords | null> {
  if (place.latitude != null && place.longitude != null) return { latitude: place.latitude, longitude: place.longitude };
  const key = formatAddress(place);
  if (!key) return null;
  if (coordsCache.has(key)) return coordsCache.get(key)!;
  const r = await verifyAddress({ address: place.address ?? '', city: place.city ?? '', state: place.state ?? '', zip: place.zip ?? '' });
  const c = r.status === 'found' ? { latitude: r.latitude, longitude: r.longitude } : null;
  // Don't remember "unavailable" (e.g. offline) so it's retried next time.
  if (r.status !== 'unavailable') coordsCache.set(key, c);
  return c;
}

/** Cached result of findCoords, without looking anything up. */
export function cachedCoords(place: Place): Coords | null | undefined {
  if (place.latitude != null && place.longitude != null) return { latitude: place.latitude, longitude: place.longitude };
  return coordsCache.get(formatAddress(place));
}

/** Straight-line distance in meters. */
export function distanceMeters(a: Coords, b: Coords): number {
  const R = 6371000;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** How close a worker must be to check in when the project doesn't set its own distance: half a mile. */
export const DEFAULT_CHECKIN_RADIUS_M = 805;

/**
 * Check-in distances the owner can slide between, in feet (stored in meters).
 * Fine steps up close, then ¼ / ½ / ¾ / 1 mile.
 */
export const CHECKIN_RADIUS_STOPS_FT = [100, 150, 200, 300, 400, 500, 750, 1000, 1320, 2640, 3960, 5280];

export const feetToMeters = (feet: number) => Math.round(feet * 0.3048);

/** Index of the stop closest to a saved distance, so older meter values land on the nearest one. */
export function nearestRadiusStop(meters: number): number {
  const feet = meters / 0.3048;
  let best = 0;
  CHECKIN_RADIUS_STOPS_FT.forEach((ft, i) => {
    if (Math.abs(ft - feet) < Math.abs(CHECKIN_RADIUS_STOPS_FT[best] - feet)) best = i;
  });
  return best;
}

/** Plain-language picture of a check-in distance. */
export function describeRadius(feet: number): string {
  if (feet <= 150) return 'Just the house and driveway';
  if (feet <= 300) return 'The lot plus the street out front';
  if (feet <= 500) return 'A few houses either way';
  if (feet <= 1000) return 'About the whole block';
  if (feet <= 1320) return 'A few blocks around the property';
  if (feet <= 2640) return 'The surrounding neighborhood';
  return 'Very loose, for estates and acreage';
}

/** "350 ft" / "0.4 mi" (¼, ½ and ¾ mi read as such). */
export function formatDistance(meters: number): string {
  const feet = meters * 3.281;
  const roundedFeet = Math.max(10, Math.round(feet / 10) * 10);
  if (roundedFeet <= 1000) return `${roundedFeet.toLocaleString('en-US')} ft`;
  const miles = meters / 1609.34;
  if (Math.abs(miles - 0.25) < 0.01) return '¼ mi';
  if (Math.abs(miles - 0.5) < 0.01) return '½ mi';
  if (Math.abs(miles - 0.75) < 0.01) return '¾ mi';
  return `${Number.isInteger(Math.round(miles * 10) / 10) ? Math.round(miles) : miles.toFixed(1)} mi`;
}
