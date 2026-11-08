/**
 * Address suggestions while typing (Google Places API (New)). Needs EXPO_PUBLIC_GOOGLE_PLACES_KEY; without it everything
 * here is off and the address fields behave exactly as before.
 *
 * One session token ties a run of keystrokes and the final pick together, so Google bills it as a single lookup.
 * The key should be restricted in Google Cloud to "Places API (New)" and to this app's bundle id.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import appJson from '../../app.json';
import { config } from '@/lib/config';
import type { AddressParts } from '@/lib/address';

export interface Suggestion { placeId: string; main: string; secondary: string }
export interface PickedPlace extends AddressParts { latitude?: number; longitude?: number }

export const placesEnabled = config.googlePlacesKey.length > 0;

/** Why the last lookup failed ("" when it worked), so the address screen can say so instead of silently showing nothing. */
let lastProblem = '';
export const lastPlacesProblem = () => lastProblem;

/** This app's bundle id. The key is restricted to the iPhone app, so Google must be told which app is asking: it is read from the running app, and if that is not available, from the app's own config file. */
const BUNDLE_ID = Constants.expoConfig?.ios?.bundleIdentifier ?? Constants.manifest2?.extra?.expoClient?.ios?.bundleIdentifier ?? (appJson as { expo?: { ios?: { bundleIdentifier?: string } } }).expo?.ios?.bundleIdentifier;

const BASE = 'https://places.googleapis.com/v1';

/** A fresh token per typing session (a random string; Google only needs it to be unique). */
export function newSessionToken(): string {
  const r = () => Math.random().toString(16).slice(2, 10);
  return `${r()}${r()}${r()}${r()}`;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': config.googlePlacesKey, ...extra };
  // A key restricted to the iPhone app is only accepted when the request says which app it is.
  if (Platform.OS === 'ios' && BUNDLE_ID) h['X-Ios-Bundle-Identifier'] = BUNDLE_ID;
  return h;
}

/** Pure: Google's autocomplete answer -> the rows to show. Anything without a place id is dropped. */
export function parseSuggestions(data: unknown): Suggestion[] {
  const list = (data as { suggestions?: { placePrediction?: Record<string, any> }[] } | null)?.suggestions ?? [];
  const out: Suggestion[] = [];
  for (const s of list) {
    const p = s.placePrediction;
    if (!p?.placeId) continue;
    const main = p.structuredFormat?.mainText?.text ?? p.text?.text ?? '';
    if (!main) continue;
    out.push({ placeId: String(p.placeId), main, secondary: p.structuredFormat?.secondaryText?.text ?? '' });
  }
  return out.slice(0, 5);
}

type Component = { longText?: string; shortText?: string; types?: string[] };

/** Pure: a place's address components -> our four address fields (street = "12 Oak St", state as "NJ", 5-digit ZIP). */
export function parsePlace(data: unknown): PickedPlace | null {
  const d = data as { addressComponents?: Component[]; location?: { latitude?: number; longitude?: number } } | null;
  const parts = d?.addressComponents;
  if (!parts?.length) return null;
  const find = (type: string) => parts.find((c) => c.types?.includes(type));
  const number = find('street_number')?.longText ?? '';
  const route = find('route')?.shortText ?? find('route')?.longText ?? '';
  const unit = find('subpremise')?.longText;
  const street = [number, route].filter(Boolean).join(' ') + (unit ? ` #${unit}` : '');
  if (!street.trim()) return null;
  const city = (find('locality') ?? find('postal_town') ?? find('sublocality') ?? find('sublocality_level_1') ?? find('administrative_area_level_3'))?.longText ?? '';
  const state = find('administrative_area_level_1')?.shortText ?? '';
  const zip = (find('postal_code')?.longText ?? '').slice(0, 5);
  return { address: street.trim(), city, state, zip, latitude: d?.location?.latitude, longitude: d?.location?.longitude };
}

/** Suggestions for what has been typed so far (US addresses). Empty when off, too short, or on any error. */
export async function fetchSuggestions(input: string, sessionToken: string, signal?: AbortSignal): Promise<Suggestion[]> {
  if (!placesEnabled || input.trim().length < 3) return [];
  try {
    const res = await fetch(`${BASE}/places:autocomplete`, {
      method: 'POST',
      headers: headers(),
      signal,
      body: JSON.stringify({
        input: input.trim(), sessionToken, includedRegionCodes: ['us'],
        includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
      }),
    });
    if (!res.ok) {
      let why = `error ${res.status}`;
      try { why = ((await res.json()) as { error?: { message?: string } })?.error?.message ?? why; } catch { /* keep the status */ }
      lastProblem = why;
      return [];
    }
    lastProblem = '';
    return parseSuggestions(await res.json());
  } catch (e) {
    lastProblem = e instanceof Error ? e.message : 'no connection';
    return [];
  }
}

/** The full address (and map spot) for a picked suggestion. Null when off or on any error: the field then keeps what was typed. */
export async function fetchPlace(placeId: string, sessionToken: string): Promise<PickedPlace | null> {
  if (!placesEnabled) return null;
  try {
    const res = await fetch(`${BASE}/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`, {
      headers: headers({ 'X-Goog-FieldMask': 'addressComponents,location' }),
    });
    if (!res.ok) return null;
    return parsePlace(await res.json());
  } catch {
    return null;
  }
}
