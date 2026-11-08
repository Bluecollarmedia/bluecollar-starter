/**
 * weather — Brighton Weather's data source: the National Weather Service (NWS) API, read on the server and shaped into one small answer.
 *
 * The app never talks to NWS itself. It asks this function for a town, and the function:
 *   1. refuses unless the owner's public Weather switch is ON (public_weather_config, update 103), so nothing is served while Weather is off;
 *   2. answers for the eight towns near Brighton (fixed list below, each point from the US Census and checked against NWS) and for any other US point
 *      (its forecast grid is looked up from NWS /points, which also says the place's time zone);
 *   3. reads NWS (forecast, hourly, raw grid for snowfall, active alerts), converts it, and keeps the answer for 10 minutes;
 *   4. if NWS is unreachable, hands back the last good answer marked stale, or says it is unavailable.
 * NWS needs no key; it asks for a User-Agent that says who is calling. Set the secret NWS_CONTACT to an email to add it (optional).
 *
 * Nothing here invents data: a missing snowfall number comes back as null ("unavailable"), never as 0.
 * This is ONE self-contained file (it can be pasted into the Supabase dashboard as it is). Everything above the marker line below is pure
 * code with no imports, and scripts/checks/weatherData.check.cjs runs it in Node against real NWS responses.
 */

// ───────────────────────────── pure part (no imports) ─────────────────────────────

export interface Town { name: string; lat: number; lon: number; office: string; gridX: number; gridY: number; zone: string; tz: string }

/** The supported towns. lat/lon: US Census 2023 Gazetteer internal point of the municipality, rounded to 4 decimals (the precision NWS accepts).
 *  grid/zone: from NWS /points for that point (2026-10-26). Freehold means the borough. */
export const TOWNS: Record<string, Town> = {
  'lakewood': { name: 'Lakewood', lat: 40.0771, lon: -74.1985, office: 'PHI', gridX: 82, gridY: 89, zone: 'NJZ020', tz: 'America/New_York' },
  'jackson': { name: 'Jackson', lat: 40.0909, lon: -74.3613, office: 'PHI', gridX: 76, gridY: 89, zone: 'NJZ020', tz: 'America/New_York' },
  'howell': { name: 'Howell', lat: 40.1781, lon: -74.2062, office: 'PHI', gridX: 81, gridY: 94, zone: 'NJZ013', tz: 'America/New_York' },
  'toms-river': { name: 'Toms River', lat: 39.9943, lon: -74.1662, office: 'PHI', gridX: 84, gridY: 86, zone: 'NJZ020', tz: 'America/New_York' },
  'brick': { name: 'Brick', lat: 40.0618, lon: -74.1096, office: 'PHI', gridX: 85, gridY: 89, zone: 'NJZ020', tz: 'America/New_York' },
  'manchester': { name: 'Manchester', lat: 39.9616, lon: -74.3753, office: 'PHI', gridX: 77, gridY: 83, zone: 'NJZ020', tz: 'America/New_York' },
  'freehold': { name: 'Freehold', lat: 40.2602, lon: -74.2759, office: 'PHI', gridX: 78, gridY: 97, zone: 'NJZ013', tz: 'America/New_York' },
  'point-pleasant': { name: 'Point Pleasant', lat: 40.0777, lon: -74.0699, office: 'PHI', gridX: 87, gridY: 90, zone: 'NJZ026', tz: 'America/New_York' },
};

export type WxIcon = 'sun' | 'moon' | 'partly' | 'partlynight' | 'cloud' | 'drizzle' | 'rain' | 'heavyrain' | 'storm' | 'snow' | 'heavysnow' | 'sleet' | 'hail' | 'fog' | 'haze' | 'smoke' | 'dust' | 'wind';

/** One hour. Every figure is null when NWS has none for that hour ("unavailable"), never a made-up zero. */
export interface WxHour {
  time: string; tempF: number | null; popPct: number | null; icon: WxIcon;
  feelsF: number | null; windMph: number | null; windDir: string; gustMph: number | null;
  humidityPct: number | null; dewF: number | null; precipIn: number | null; cloudPct: number | null;
}
export interface WxDay { date: string; highF: number | null; lowF: number | null; popPct: number | null; icon: WxIcon; text: string; snowIn: number | null }
export interface WxAlert { id: string; event: string; severity: string; urgency: string; headline: string; description: string; instruction: string; sender: string; effective: string | null; expires: string | null }
export interface WeatherPayload {
  /** The place's own time zone. */
  tz: string;
  town: string;
  townName: string;
  fetchedAt: number;
  updatedAt: string | null;
  current: { tempF: number | null; text: string; icon: WxIcon; isDaytime: boolean } | null;
  today: { highF: number | null; lowF: number | null };
  hourly: WxHour[];
  daily: WxDay[];
  alerts: WxAlert[];
  source: string;
}

/** One word for the picture, from NWS's own short text (never from anything invented). The kinds follow the list in Apple's "Learn the weather icons" article. */
export function iconFor(shortForecast: string, isDaytime: boolean): WxIcon {
  const t = (shortForecast || '').toLowerCase();
  if (/thunder|t-storm/.test(t)) return 'storm';
  if (/blizzard|heavy snow/.test(t)) return 'heavysnow';
  if (/sleet|freezing rain|wintry|ice pellet|rain and snow|snow and rain/.test(t)) return 'sleet';
  if (/hail/.test(t)) return 'hail';
  if (/snow|flurr/.test(t)) return 'snow';
  if (/drizzle/.test(t)) return 'drizzle';
  if (/heavy rain|downpour/.test(t)) return 'heavyrain';
  if (/rain|shower/.test(t)) return 'rain';
  if (/smoke/.test(t)) return 'smoke';
  if (/dust|sand/.test(t)) return 'dust';
  if (/fog|mist/.test(t)) return 'fog';
  if (/haze/.test(t)) return 'haze';
  if (/^(windy|breezy|blustery|gusty)$/.test(t.trim())) return 'wind';
  if (/mostly clear/.test(t)) return isDaytime ? 'partly' : 'moon';
  if (/partly|mostly sunny/.test(t)) return isDaytime ? 'partly' : 'partlynight';
  if (/cloud|overcast/.test(t)) return 'cloud';
  if (/sunny|clear|fair/.test(t)) return isDaytime ? 'sun' : 'moon';
  return 'cloud';
}

const HOUR = 3_600_000;
const floorHour = (ms: number) => Math.floor(ms / HOUR) * HOUR;

/** "2026-10-26T14:00:00+00:00/PT4H" or ".../P5DT22H" -> start and end in ms. null when it cannot be read. */
export function parseValidTime(vt: string): { start: number; end: number } | null {
  const [a, d] = String(vt || '').split('/');
  const start = Date.parse(a);
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(d || '');
  if (!Number.isFinite(start) || !m) return null;
  const ms = (Number(m[1] || 0) * 24 + Number(m[2] || 0)) * HOUR + Number(m[3] || 0) * 60_000;
  return ms > 0 ? { start, end: start + ms } : null;
}

export function localDate(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

const toInches = (uom: string): number | null =>
  uom === 'wmoUnit:mm' ? 1 / 25.4 : uom === 'wmoUnit:cm' ? 10 / 25.4 : uom === 'wmoUnit:m' ? 1000 / 25.4 : null;

/**
 * Snowfall forecast in inches per local calendar day, from NWS's raw grid (snowfallAmount blocks of several hours).
 * A day gets a number ONLY when every hour of it (from `fromMs` on) is covered by a block with a real number. Otherwise the day is null
 * ("unavailable"). A real 0 stays 0. Unknown units give null for every day.
 */
export function snowByLocalDay(values: Array<{ validTime: string; value: number | null }> | undefined, uom: string, fromMs: number, toMs: number, tz: string): Record<string, number | null> {
  const factor = toInches(uom);
  const perHour = new Map<number, number>();
  if (factor !== null) {
    for (const b of values ?? []) {
      const span = parseValidTime(b.validTime);
      if (!span || typeof b.value !== 'number' || !Number.isFinite(b.value)) continue;
      const hours = (span.end - span.start) / HOUR;
      for (let t = floorHour(span.start); t < span.end; t += HOUR) perHour.set(t, (b.value * factor) / hours);
    }
  }
  const days: Record<string, { sum: number; missing: boolean }> = {};
  for (let t = floorHour(fromMs); t < toMs; t += HOUR) {
    const d = localDate(t, tz);
    const rec = (days[d] ??= { sum: 0, missing: false });
    const v = perHour.get(t);
    if (v === undefined) rec.missing = true; else rec.sum += v;
  }
  const out: Record<string, number | null> = {};
  for (const [d, r] of Object.entries(days)) out[d] = r.missing ? null : Math.round(r.sum * 10) / 10;
  return out;
}

/**
 * One number per whole hour from an NWS raw-grid series (blocks of one or more hours).
 * 'level' series (temperature, wind) repeat their value in every hour of the block; 'amount' series (rain) share the block's total across its hours.
 * `convert` maps the unit NWS used to the unit shown, or returns null for a unit we do not know (then no hour gets a number).
 */
export function gridPerHour(values: Array<{ validTime: string; value: number | null }> | undefined, mode: 'level' | 'amount', convert: (v: number) => number | null): Map<number, number> {
  const out = new Map<number, number>();
  for (const b of values ?? []) {
    const span = parseValidTime(b.validTime);
    if (!span || typeof b.value !== 'number' || !Number.isFinite(b.value)) continue;
    const v = convert(b.value);
    if (v === null) continue;
    const hours = (span.end - span.start) / HOUR;
    for (let t = floorHour(span.start); t < span.end; t += HOUR) out.set(t, mode === 'amount' ? v / hours : v);
  }
  return out;
}

const cToF = (c: number) => (c * 9) / 5 + 32;
const kmhToMph = (k: number) => k / 1.609344;
/** "7 mph" or "5 to 10 mph" -> 7 / 10 (the higher figure), null when unreadable. */
export function windMphOf(s: unknown): number | null {
  const nums = String(s ?? '').match(/\d+(?:\.\d+)?/g);
  return nums ? Math.max(...nums.map(Number)) : null;
}
const gridUnit = (grid: any, key: string): { values: any[]; uom: string } => ({ values: grid?.properties?.[key]?.values ?? [], uom: String(grid?.properties?.[key]?.uom ?? '') });

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const tempF = (p: { temperature?: unknown; temperatureUnit?: string }): number | null => {
  const t = numOrNull(p.temperature);
  if (t === null) return null;
  return p.temperatureUnit === 'C' ? Math.round((t * 9) / 5 + 32) : Math.round(t);
};
const popOf = (p: { probabilityOfPrecipitation?: { value?: unknown } | null }): number | null => numOrNull(p.probabilityOfPrecipitation?.value);

const SEVERITY_RANK: Record<string, number> = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };

/** Alerts that are in force: real (Actual), not cancelled, not expired. The agency's own words are passed through untouched. */
export function normalizeAlerts(alerts: any, now: number): WxAlert[] {
  const out: WxAlert[] = [];
  for (const f of alerts?.features ?? []) {
    const p = f?.properties ?? {};
    if (p.status !== 'Actual' || p.messageType === 'Cancel') continue;
    const end = Date.parse(p.ends ?? p.expires ?? '');
    if (Number.isFinite(end) && end <= now) continue;
    out.push({
      id: String(p.id ?? f.id ?? ''), event: String(p.event ?? ''), severity: String(p.severity ?? 'Unknown'), urgency: String(p.urgency ?? ''),
      headline: String(p.headline ?? ''), description: String(p.description ?? ''), instruction: String(p.instruction ?? ''),
      sender: String(p.senderName ?? ''), effective: p.effective ?? null, expires: p.expires ?? null,
    });
  }
  return out.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 4) - (SEVERITY_RANK[b.severity] ?? 4));
}

/** NWS forecast + hourly + raw grid + alerts -> the small answer the app shows. */
export function normalizeForecast(input: { townKey: string; town?: Town; displayName?: string; forecast: any; hourly: any; grid: any; alerts: any; now: number }): WeatherPayload {
  const town = input.town ?? TOWNS[input.townKey];
  const tz = town?.tz ?? 'America/New_York';
  const now = input.now;
  const periods: any[] = input.forecast?.properties?.periods ?? [];
  const hoursAll: any[] = input.hourly?.properties?.periods ?? [];

  // Hourly: the period we are in, then every hour NWS has after it (about seven days).
  let firstIdx = hoursAll.findIndex((p) => Date.parse(p.startTime) <= now && now < Date.parse(p.endTime));
  if (firstIdx < 0) firstIdx = hoursAll.findIndex((p) => Date.parse(p.startTime) > now);
  const hourSlice = firstIdx < 0 ? [] : hoursAll.slice(firstIdx);

  // Feels-like, gusts and rain amount are only in the raw grid; each is matched to its hour (null when the grid has nothing for it).
  const feelsUnit = gridUnit(input.grid, 'apparentTemperature');
  const gustUnit = gridUnit(input.grid, 'windGust');
  const rainUnit = gridUnit(input.grid, 'quantitativePrecipitation');
  const cloudUnit = gridUnit(input.grid, 'skyCover');
  const clouds = gridPerHour(cloudUnit.values, 'level', (v) => (cloudUnit.uom === 'wmoUnit:percent' ? v : null));
  const feels = gridPerHour(feelsUnit.values, 'level', (v) => (feelsUnit.uom === 'wmoUnit:degC' ? cToF(v) : feelsUnit.uom === 'wmoUnit:degF' ? v : null));
  const gusts = gridPerHour(gustUnit.values, 'level', (v) => (gustUnit.uom === 'wmoUnit:km_h-1' ? kmhToMph(v) : gustUnit.uom === 'wmoUnit:m_s-1' ? v * 2.236936 : null));
  const rain = gridPerHour(rainUnit.values, 'amount', (v) => { const f = toInches(rainUnit.uom); return f === null ? null : v * f; });
  const r1 = (n: number | undefined, digits = 0): number | null => (n === undefined ? null : Math.round(n * 10 ** digits) / 10 ** digits);
  const hourly: WxHour[] = hourSlice.map((p) => {
    const t = floorHour(Date.parse(p.startTime));
    const dewC = numOrNull(p.dewpoint?.value);
    return {
      time: p.startTime, tempF: tempF(p), popPct: popOf(p), icon: iconFor(p.shortForecast, !!p.isDaytime),
      feelsF: r1(feels.get(t)), windMph: windMphOf(p.windSpeed), windDir: String(p.windDirection ?? ''), gustMph: r1(gusts.get(t)),
      humidityPct: numOrNull(p.relativeHumidity?.value), dewF: dewC === null ? null : Math.round(cToF(dewC)), precipIn: r1(rain.get(t), 2), cloudPct: r1(clouds.get(t)),
    };
  });
  const cur = hourSlice[0];
  const current = cur ? { tempF: tempF(cur), text: String(cur.shortForecast ?? ''), icon: iconFor(cur.shortForecast, !!cur.isDaytime), isDaytime: !!cur.isDaytime } : null;

  // Snowfall per local day from the raw grid.
  const snow = snowByLocalDay(input.grid?.properties?.snowfallAmount?.values, input.grid?.properties?.snowfallAmount?.uom ?? '', now, now + 9 * 24 * HOUR, tz);

  // Daily: group the 12-hour day/night periods by the local date they start on.
  const byDate = new Map<string, { day?: any; night?: any }>();
  for (const p of periods) {
    const d = localDate(Date.parse(p.startTime), tz);
    const rec = byDate.get(d) ?? {};
    if (p.isDaytime) rec.day = p; else rec.night = p;
    byDate.set(d, rec);
  }
  const todayLocal = localDate(now, tz);
  const daily: WxDay[] = [...byDate.entries()].filter(([date]) => date >= todayLocal).slice(0, 7).map(([date, r]) => {
    const lead = r.day ?? r.night;
    const pops = [r.day, r.night].map((p) => (p ? popOf(p) : null)).filter((v): v is number => v !== null);
    return {
      date,
      highF: r.day ? tempF(r.day) : null,
      lowF: r.night ? tempF(r.night) : null,
      popPct: pops.length ? Math.max(...pops) : null,
      icon: iconFor(lead?.shortForecast ?? '', !!r.day),
      text: String(lead?.shortForecast ?? ''),
      snowIn: Object.prototype.hasOwnProperty.call(snow, date) ? snow[date] : null,
    };
  });

  const temps = hourSlice.map((p) => tempF(p)).filter((v): v is number => v !== null);
  const today = {
    highF: daily[0]?.highF ?? (temps.length ? Math.max(...temps) : null),
    lowF: daily[0]?.lowF ?? (temps.length ? Math.min(...temps) : null),
  };

  return {
    town: input.townKey,
    townName: input.displayName || town?.name || input.townKey,
    tz,
    fetchedAt: now,
    updatedAt: input.forecast?.properties?.generatedAt ?? input.forecast?.properties?.updateTime ?? null,
    current,
    today,
    hourly,
    daily,
    alerts: normalizeAlerts(input.alerts, now),
    source: 'National Weather Service',
  };
}

// ───────────────────────────── Deno edge function below ─────────────────────────────
// @ts-ignore: Deno edge runtime
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
// @ts-ignore: Deno edge runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

declare const Deno: { env: { get(k: string): string | undefined } };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const CONTACT = Deno.env.get('NWS_CONTACT');
const USER_AGENT = `BrightonLawnWeather/1.0 (app.brightonlawn.com${CONTACT ? `, ${CONTACT}` : ''})`;
const TTL_MS = 10 * 60 * 1000;
const NWS_TIMEOUT_MS = 8000;

// Best-effort memory of recent answers (a warm instance keeps it; a cold one starts empty).
const memory = new Map<string, { at: number; payload: WeatherPayload }>();
const MEMORY_MAX = 300;

// A point's forecast grid never changes, so it is remembered for a day.
const resolved = new Map<string, { at: number; town: Town | null }>();
const RESOLVE_TTL_MS = 24 * 60 * 60 * 1000;

/** The forecast grid, zone and time zone NWS gives for a point (4 decimals). null when NWS has no forecast for it (outside the US). */
async function resolvePoint(lat: number, lon: number, name: string): Promise<Town | null> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const hit = resolved.get(key);
  if (hit && Date.now() - hit.at < RESOLVE_TTL_MS) return hit.town ? { ...hit.town, name } : null;
  let town: Town | null = null;
  try {
    const p = (await nws(`/points/${key}`))?.properties;
    const zone = String(p?.forecastZone ?? '').split('/').pop() ?? '';
    if (p?.gridId && Number.isFinite(p.gridX) && Number.isFinite(p.gridY) && zone && p.timeZone) {
      town = { name, lat, lon, office: String(p.gridId), gridX: Number(p.gridX), gridY: Number(p.gridY), zone, tz: String(p.timeZone) };
    }
  } catch { town = null; }
  if (resolved.size > MEMORY_MAX) resolved.delete(resolved.keys().next().value as string);
  resolved.set(key, { at: Date.now(), town });
  return town ? { ...town } : null;
}

/** A place name from a person: letters, numbers and a few marks only, at most 60 characters. */
const cleanName = (v: unknown): string => String(v ?? '').replace(/[^\p{L}\p{N} .,'’-]/gu, '').trim().slice(0, 60);

async function nws(path: string): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), NWS_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.weather.gov${path}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' }, signal: ctl.signal });
    if (!res.ok) throw new Error(`NWS ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function weatherIsOn(): Promise<boolean | null> {
  try {
    const sb = createClient(SUPABASE_URL, ANON_KEY);
    const { data, error } = await sb.rpc('public_weather_config');
    if (error) return null;
    return (data as { enabled?: unknown } | null)?.enabled === true;
  } catch {
    return null;
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method' });

  let body: { town?: unknown; lat?: unknown; lon?: unknown; name?: unknown } | null = null;
  try { body = (await req.json()) as typeof body; } catch { /* handled below */ }
  let townKey = '';
  let town: Town | undefined;
  let displayName = '';
  if (typeof body?.town === 'string' && TOWNS[body.town]) {
    townKey = body.town;
    town = TOWNS[townKey];
  } else if (body && Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lon)) && body.lat !== null && body.lon !== null) {
    // Any other US point: rounded to three decimals (about 100 metres), inside the United States and its territories.
    const lat = Math.round(Number(body.lat) * 1000) / 1000;
    const lon = Math.round(Number(body.lon) * 1000) / 1000;
    if (lat < 17 || lat > 72 || lon < -180 || lon > -60) return json(400, { error: 'place' });
    townKey = `p:${lat.toFixed(3)},${lon.toFixed(3)}`;
    displayName = cleanName(body.name);
  } else {
    return json(400, { error: 'town' });
  }

  // Nothing is served while the owner has Weather switched off (or when the switch cannot be read).
  const on = await weatherIsOn();
  if (on === null) return json(503, { error: 'unavailable' });
  if (!on) return json(403, { error: 'disabled' });

  const cached = memory.get(townKey);
  if (cached && Date.now() - cached.at < TTL_MS) return json(200, { ok: true, stale: false, data: cached.payload });

  if (!town) {
    const [la, lo] = townKey.slice(2).split(',').map(Number);
    const found = await resolvePoint(la, lo, displayName || 'This place');
    if (!found) return json(404, { error: 'place' });
    town = found;
  }

  try {
    const grid = `/gridpoints/${town.office}/${town.gridX},${town.gridY}`;
    const [forecast, hourly, gridData, alerts] = await Promise.all([
      nws(`${grid}/forecast`), nws(`${grid}/forecast/hourly`), nws(grid), nws(`/alerts/active?zone=${town.zone}`),
    ]);
    const payload = normalizeForecast({ townKey, town, displayName, forecast, hourly, grid: gridData, alerts, now: Date.now() });
    if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value as string);
    memory.set(townKey, { at: Date.now(), payload });
    return json(200, { ok: true, stale: false, data: payload });
  } catch {
    if (cached) return json(200, { ok: true, stale: true, data: cached.payload });
    return json(502, { error: 'unavailable' });
  }
});
