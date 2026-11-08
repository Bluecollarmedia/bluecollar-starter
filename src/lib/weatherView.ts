/**
 * Plain helpers for showing a weather answer (pure: no React, no network). The answer's shape is defined by the weather function
 * (supabase/functions/weather/index.ts); the types are repeated here so the app does not import server code.
 */
export type WxIcon = 'sun' | 'moon' | 'partly' | 'partlynight' | 'cloud' | 'drizzle' | 'rain' | 'heavyrain' | 'storm' | 'snow' | 'heavysnow' | 'sleet' | 'hail' | 'fog' | 'haze' | 'smoke' | 'dust' | 'wind';
export interface WxHour {
  time: string; tempF: number | null; popPct: number | null; icon: WxIcon;
  feelsF: number | null; windMph: number | null; windDir: string; gustMph: number | null;
  humidityPct: number | null; dewF: number | null; precipIn: number | null; cloudPct: number | null;
  /** The UV index estimate for the hour (worked out in the app: see uvIndexAt). */
  uvIndex: number | null;
}
export interface WxDay { date: string; highF: number | null; lowF: number | null; popPct: number | null; icon: WxIcon; text: string; snowIn: number | null }
export interface WxAlert { id: string; event: string; severity: string; urgency: string; headline: string; description: string; instruction: string; sender: string; effective: string | null; expires: string | null }
export interface WeatherPayload {
  town: string; townName: string; fetchedAt: number; updatedAt: string | null;
  /** The place's own time zone (every time and day on screen follows it). Missing from older answers: Eastern. */
  tz?: string;
  current: { tempF: number | null; text: string; icon: WxIcon; isDaytime: boolean } | null;
  today: { highF: number | null; lowF: number | null };
  hourly: WxHour[]; daily: WxDay[]; alerts: WxAlert[]; source: string;
}

/** How a snowfall figure is worded. null = the forecast has no figure for that day: "unavailable", never "0". */
export function snowKind(snowIn: number | null): 'unavailable' | 'none' | 'trace' | 'amount' {
  if (snowIn === null || !Number.isFinite(snowIn)) return 'unavailable';
  if (snowIn === 0) return 'none';
  if (snowIn < 0.1) return 'trace';
  return 'amount';
}

/** Whole minutes since the answer was fetched (never negative). */
export const ageMinutes = (fetchedAt: number, now: number): number => Math.max(0, Math.floor((now - fetchedAt) / 60_000));

/** The temperature to show, or an en dash when there is none. */
export const degrees = (f: number | null | undefined): string => (typeof f === 'number' && Number.isFinite(f) ? `${Math.round(f)}°` : '–');

const NY = 'America/New_York';
let VIEW_TZ = NY;
/** Sets the time zone of the place on screen: every day and hour label, and "today", follow it. */
export function setViewTz(tz?: string | null): void {
  try { if (tz) { new Intl.DateTimeFormat('en-US', { timeZone: tz }); VIEW_TZ = tz; return; } } catch { /* not a time zone we know */ }
  VIEW_TZ = NY;
}
export const viewTz = (): string => VIEW_TZ;
/** "Tue" / "mar" for a calendar date like 2026-10-27 (the weekday of that date, not shifted by the phone's time zone). */
export function weekdayShort(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
/** "4 PM" in the towns' time (Eastern), whatever time zone the phone is in. */
export function hourLabel(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone: VIEW_TZ }).format(new Date(iso));
}
export function timeLabel(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: VIEW_TZ }).format(new Date(iso));
}
/** Today's date in the towns' time as YYYY-MM-DD. */
export const todayInTowns = (now: number, tz: string = VIEW_TZ): string => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));

// ───────────── helpers for the home and details screens ─────────────

/** A number with a unit, or an en dash when NWS had no figure (callers word that as "Unavailable" where there is room). */
export const orDash = (v: number | null | undefined, unit = '', digits = 0): string =>
  typeof v === 'number' && Number.isFinite(v) ? `${digits ? v.toFixed(digits) : Math.round(v)}${unit}` : '–';

export const localDay = (iso: string): string => todayInTowns(Date.parse(iso));
/** Hours that start on a local calendar date (the towns' time). */
export const hoursOnDate = (hours: WxHour[], date: string): WxHour[] => hours.filter((h) => localDay(h.time) === date);

/** What the wind is doing, in plain words (informal bands). */
export function windWord(mph: number | null): 'Calm' | 'Light' | 'Breezy' | 'Windy' | 'Very windy' | null {
  if (mph === null || !Number.isFinite(mph)) return null;
  if (mph < 4) return 'Calm';
  if (mph < 13) return 'Light';
  if (mph < 25) return 'Breezy';
  if (mph < 39) return 'Windy';
  return 'Very windy';
}

/** How the air feels, from the dew point (the common rule of thumb). */
export function dewWord(dewF: number | null): 'Dry' | 'Comfortable' | 'A little humid' | 'Humid' | 'Very humid' | null {
  if (dewF === null || !Number.isFinite(dewF)) return null;
  if (dewF < 50) return 'Dry';
  if (dewF < 60) return 'Comfortable';
  if (dewF < 65) return 'A little humid';
  if (dewF < 70) return 'Humid';
  return 'Very humid';
}

/** The first hour in the next 24 where rain or snow is likely (40% or more), or null. */
export function firstWetHour(hours: WxHour[]): { index: number; time: string; snow: boolean } | null {
  const i = hours.slice(0, 24).findIndex((h) => typeof h.popPct === 'number' && h.popPct >= 40);
  return i < 0 ? null : { index: i, time: hours[i].time, snow: hours[i].icon === 'snow' || hours[i].icon === 'heavysnow' || hours[i].icon === 'sleet' };
}

/** Where a day's low and high sit (0..1) inside the week's range, for the temperature bar. null when a figure is missing. */
export function barSpan(day: { lowF: number | null; highF: number | null }, days: Array<{ lowF: number | null; highF: number | null }>): { from: number; to: number } | null {
  const lows = days.map((d) => d.lowF).filter((v): v is number => v !== null);
  const highs = days.map((d) => d.highF).filter((v): v is number => v !== null);
  if (!lows.length || !highs.length || day.lowF === null || day.highF === null) return null;
  const lo = Math.min(...lows);
  const span = Math.max(1, Math.max(...highs) - lo);
  return { from: (day.lowF - lo) / span, to: (day.highF - lo) / span };
}

/** A colour for a temperature, cold to hot (the day bars and the chart). Chosen to read on white. */
export function tempColor(f: number | null): string {
  if (f === null) return '#9FB3A6';
  if (f <= 32) return '#5BB3F0';
  if (f <= 50) return '#3FBF9A';
  if (f <= 65) return '#7CC25A';
  if (f <= 80) return '#E8C23A';
  if (f <= 90) return '#EE8B3A';
  return '#E5604F';
}

const DAY_MS = 86_400_000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const norm = (v: number, n: number) => ((v % n) + n) % n;

/**
 * Sunrise and sunset (ms) for a calendar date and place, worked out from the date and position alone (the "Almanac for Computers" method).
 * Accurate to a few minutes. null when the sun does not rise or set that day.
 */
export function sunTimes(date: string, lat: number, lon: number): { rise: number; set: number } | null {
  const [y, m, d] = date.split('-').map(Number);
  const N = Math.floor((275 * m) / 9) - Math.floor((m + 9) / 12) * (1 + Math.floor((y - 4 * Math.floor(y / 4) + 2) / 3)) + d - 30;
  const lngHour = lon / 15;
  const calc = (rising: boolean): number | null => {
    const t = N + ((rising ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    const L = norm(M + 1.916 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 282.634, 360);
    let RA = norm(deg(Math.atan(0.91764 * Math.tan(rad(L)))), 360);
    RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
    RA /= 15;
    const sinDec = 0.39782 * Math.sin(rad(L));
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(rad(90.833)) - sinDec * Math.sin(rad(lat))) / (cosDec * Math.cos(rad(lat)));
    if (cosH > 1 || cosH < -1) return null;
    const H = (rising ? 360 - deg(Math.acos(cosH)) : deg(Math.acos(cosH))) / 15;
    const T = H + RA - 0.06571 * t - 6.622;
    return norm(T - lngHour, 24);
  };
  const r = calc(true);
  const s = calc(false);
  if (r === null || s === null) return null;
  const base = Date.UTC(y, m - 1, d);
  const rise = base + r * 3_600_000;
  let set = base + s * 3_600_000;
  if (set < rise) set += DAY_MS;
  return { rise, set };
}

const SYNODIC = 29.530588853;
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14);
/** Age of the moon in days (0 = new), from the date alone. */
export const moonAge = (ms: number): number => norm((ms - NEW_MOON_REF) / DAY_MS, SYNODIC);
export type MoonName = 'New Moon' | 'Waxing Crescent' | 'First Quarter' | 'Waxing Gibbous' | 'Full Moon' | 'Waning Gibbous' | 'Last Quarter' | 'Waning Crescent';
export function moonPhase(ms: number): { name: MoonName; illumination: number; age: number } {
  const age = moonAge(ms);
  const illumination = (1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2;
  const f = age / SYNODIC;
  const name: MoonName = f < 0.03 || f >= 0.97 ? 'New Moon' : f < 0.22 ? 'Waxing Crescent' : f < 0.28 ? 'First Quarter' : f < 0.47 ? 'Waxing Gibbous' : f < 0.53 ? 'Full Moon' : f < 0.72 ? 'Waning Gibbous' : f < 0.78 ? 'Last Quarter' : 'Waning Crescent';
  return { name, illumination, age };
}
/** The next New, First Quarter, Full and Last Quarter moons after `ms`, soonest first (a mean-cycle estimate: good to about a day). */
export function nextMoons(ms: number): Array<{ name: 'New Moon' | 'First Quarter' | 'Full Moon' | 'Last Quarter'; at: number }> {
  const names = ['New Moon', 'First Quarter', 'Full Moon', 'Last Quarter'] as const;
  const age = moonAge(ms);
  return names.map((name, i) => ({ name, at: ms + norm((i * SYNODIC) / 4 - age, SYNODIC) * DAY_MS })).sort((a, b) => a.at - b.at);
}

/**
 * An answer from the weather function with every hourly figure present. An older version of the function (before it sent feels-like, wind,
 * humidity and so on) leaves them out; they become null ("unavailable") instead of undefined, so the screens never show NaN.
 */
export function completePayload(p: WeatherPayload, at?: { lat: number; lon: number }): WeatherPayload {
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    ...p,
    hourly: (p.hourly ?? []).map((h) => ({
      time: h.time, tempF: n(h.tempF), popPct: n(h.popPct), icon: h.icon,
      feelsF: n(h.feelsF), windMph: n(h.windMph), windDir: typeof h.windDir === 'string' ? h.windDir : '', gustMph: n(h.gustMph),
      humidityPct: n(h.humidityPct), dewF: n(h.dewF), precipIn: n(h.precipIn), cloudPct: n(h.cloudPct),
      uvIndex: at ? uvIndexAt(Date.parse(h.time), at.lat, at.lon, n(h.cloudPct)) : null,
    })),
    // Days that have already passed (the overnight hours after midnight belong to yesterday's forecast) are not shown.
    tz: p.tz ?? NY,
    daily: (p.daily ?? []).filter((d) => d.date >= todayInTowns(Date.now(), p.tz ?? NY)),
    alerts: p.alerts ?? [],
  };
}

// ───────────── UV index (an estimate) ─────────────
// The National Weather Service publishes no UV index, so the app works one out: the sun's real height in the sky for that place and hour
// (exact astronomy), the usual clear-sky UV for that height, then reduced by the forecast cloud cover. It is an estimate, and is labelled as one.

/** The sun's height above the horizon in degrees (negative at night) for a moment and place (NOAA solar position formulas). */
export function solarElevation(ms: number, lat: number, lon: number): number {
  const jd = ms / 86_400_000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const L0 = norm(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = norm(357.52911 + T * (35999.05029 - 0.0001537 * T), 360);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = (1.914602 - T * (0.004817 + 0.000014 * T)) * Math.sin(rad(M)) + (0.019993 - 0.000101 * T) * Math.sin(rad(2 * M)) + 0.000289 * Math.sin(rad(3 * M));
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(rad(omega));
  const decl = Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda)));
  const y = Math.tan(rad(eps) / 2) ** 2;
  const eot = 4 * deg(y * Math.sin(rad(2 * L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * y * Math.sin(rad(M)) * Math.cos(rad(2 * L0)) - 0.5 * y * y * Math.sin(rad(4 * L0)) - 1.25 * e * e * Math.sin(rad(2 * M)));
  const d = new Date(ms);
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const solarTime = norm(utcMin + eot + 4 * lon, 1440);
  const ha = solarTime / 4 - 180;
  return deg(Math.asin(Math.sin(rad(lat)) * Math.sin(decl) + Math.cos(rad(lat)) * Math.cos(decl) * Math.cos(rad(ha))));
}

/** The UV index for an hour: clear-sky value for the sun's height, times a cloud factor. 0 at night; whole numbers; null when the time is unreadable. */
export function uvIndexAt(ms: number, lat: number, lon: number, cloudPct: number | null): number | null {
  if (!Number.isFinite(ms)) return null;
  const elev = solarElevation(ms + 1_800_000, lat, lon);   // the middle of the hour
  if (elev <= 0) return 0;
  const mu0 = Math.sin(rad(elev));
  const clear = 12.5 * Math.pow(mu0, 2.42) * Math.pow(300 / 320, 1.23) * 0.95;   // typical ozone and air for New Jersey
  const c = cloudPct === null || !Number.isFinite(cloudPct) ? 0 : Math.min(1, Math.max(0, cloudPct / 100));
  const cloud = 1 - 0.75 * Math.pow(c, 3.4);
  return Math.round(clear * cloud);
}

export type UvLevel = 'Low' | 'Moderate' | 'High' | 'Very high' | 'Extreme';
/** The World Health Organization's UV bands. */
export function uvLevel(uv: number): UvLevel {
  if (uv <= 2) return 'Low';
  if (uv <= 5) return 'Moderate';
  if (uv <= 7) return 'High';
  if (uv <= 10) return 'Very high';
  return 'Extreme';
}
export function uvColor(uv: number | null): string {
  // Darker than a traffic light on purpose, so the number stays readable as text on white.
  if (uv === null) return '#6F8B80';
  if (uv <= 2) return '#2E8B45';
  if (uv <= 5) return '#9C7500';
  if (uv <= 7) return '#C2620F';
  if (uv <= 10) return '#C2381F';
  return '#8E3FBF';
}
export function uvAdvice(level: UvLevel): string {
  return level === 'Low' ? 'No sun protection needed for most people.'
    : level === 'Moderate' ? 'Wear sunscreen and sunglasses if you are out for a while.'
    : level === 'High' ? 'Cover up, wear sunscreen, and take breaks in the shade.'
    : level === 'Very high' ? 'Extra care: sunscreen, hat, and shade around midday.'
    : 'Avoid the sun in the middle of the day.';
}

// ── The chart's hour labels: one for every hour that fits ───────────────────────────────────────────────────────────────────────

/** An hour split into its number and its AM/PM (null in 24-hour languages, where there is no AM/PM). */
export function hourParts(iso: string, locale: string): { num: string; period: string | null } {
  const parts = new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone: VIEW_TZ }).formatToParts(new Date(iso));
  return { num: parts.find((p) => p.type === 'hour')?.value ?? '', period: parts.find((p) => p.type === 'dayPeriod')?.value ?? null };
}

/**
 * How many hours apart the labels under a chart are: every hour (1) while each label has at least `minGap` points to itself, otherwise every 2nd,
 * 3rd... hour. 15 hours across a phone get a label each; a 24-hour day gets one every 2 hours.
 */
export function axisStep(hourCount: number, plotW: number, minGap = 16): number {
  if (hourCount < 2 || !(plotW > 0)) return 1;
  const gap = plotW / (hourCount - 1);
  return Math.max(1, Math.ceil(minGap / gap));
}
