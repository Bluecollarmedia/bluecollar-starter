/**
 * What the Forecast widgets show, worked out from the forecast the app already has (pure: no React, no network).
 *
 * The widgets cannot ask for weather themselves, so the app hands them a timeline: one entry for each of the next 24 hours, each carrying the
 * words and figures for that hour. The phone switches entries on its own as the day goes on, so the temperature stays right between app opens.
 * Anything the forecast has no figure for is left out or shown as an en dash, never as 0.
 */
import { hourLabel, type WeatherPayload, type WxHour, type WxIcon } from '@/lib/weatherView';
import { brand } from '@/config/brand';
import { widgetColors, widgetSymbolColors } from '@/theme/weather';

/** The widget runs in its own small runtime and cannot read the settings file, so these two settings travel in its props. */
const WIDGET_LINK = `${brand.app.scheme}://weather`;
const WIDGET_NAME = brand.company.name.toUpperCase();

export interface WidgetHour { label: string; temp: string; symbol: string }
export interface WidgetProps {
  place: string;
  temp: string;
  condition: string;
  symbol: string;
  symbolColor: string;
  /** "H 61°  L 41°", or an en dash pair when the forecast has neither. */
  highLow: string;
  /** "UV 3", or empty when there is no figure or the sun is down. */
  uv: string;
  /** "No rain expected", "Rain chance 60%", or empty when there is no figure. */
  rain: string;
  hours: WidgetHour[];
  /** The logo mark as a file address in the widgets' shared folder, or null (then the widgets just leave it out). */
  leaf: string | null;
  /** For the lock screen circle: where the temperature sits between today's low and high. */
  gauge: { now: number; low: number; high: number } | null;
  /** Where tapping the widget goes: the app's own weather link (settings file: app.scheme). */
  link: string;
  /** The company name in capitals, shown next to the logo mark (settings file: company.name). */
  company: string;
  /** The widget's colors (the plain look, src/theme/weather.ts): the widget cannot read the theme itself. */
  colors: WidgetColors;
}
export interface WidgetColors { ink: string; soft: string; page: string; accent: string; rule: string }
export interface WidgetEntry { date: Date; props: WidgetProps }

const SYMBOL: Record<WxIcon, { name: string; color: string; word: string }> = {
  sun: { name: 'sun.max.fill', color: widgetSymbolColors.sun, word: 'Sunny' },
  moon: { name: 'moon.stars.fill', color: widgetSymbolColors.moon, word: 'Clear' },
  partly: { name: 'cloud.sun.fill', color: widgetSymbolColors.partly, word: 'Partly cloudy' },
  partlynight: { name: 'cloud.moon.fill', color: widgetSymbolColors.partlynight, word: 'Partly cloudy' },
  cloud: { name: 'cloud.fill', color: widgetSymbolColors.cloud, word: 'Cloudy' },
  drizzle: { name: 'cloud.drizzle.fill', color: widgetSymbolColors.drizzle, word: 'Drizzle' },
  rain: { name: 'cloud.rain.fill', color: widgetSymbolColors.rain, word: 'Rain' },
  heavyrain: { name: 'cloud.heavyrain.fill', color: widgetSymbolColors.heavyrain, word: 'Heavy rain' },
  storm: { name: 'cloud.bolt.rain.fill', color: widgetSymbolColors.storm, word: 'Thunderstorms' },
  snow: { name: 'cloud.snow.fill', color: widgetSymbolColors.snow, word: 'Snow' },
  heavysnow: { name: 'snowflake', color: widgetSymbolColors.heavysnow, word: 'Heavy snow' },
  sleet: { name: 'cloud.sleet.fill', color: widgetSymbolColors.sleet, word: 'Sleet' },
  hail: { name: 'cloud.hail.fill', color: widgetSymbolColors.hail, word: 'Hail' },
  fog: { name: 'cloud.fog.fill', color: widgetSymbolColors.fog, word: 'Fog' },
  haze: { name: 'sun.haze.fill', color: widgetSymbolColors.haze, word: 'Hazy' },
  smoke: { name: 'smoke.fill', color: widgetSymbolColors.smoke, word: 'Smoke' },
  dust: { name: 'sun.dust.fill', color: widgetSymbolColors.dust, word: 'Dust' },
  wind: { name: 'wind', color: widgetSymbolColors.wind, word: 'Windy' },
};
const FALLBACK = SYMBOL.cloud;
const symbolOf = (icon: WxIcon | undefined) => (icon && SYMBOL[icon]) || FALLBACK;

const deg = (f: number | null | undefined): string => (typeof f === 'number' && Number.isFinite(f) ? `${Math.round(f)}°` : '–');
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** How many hourly entries the phone is given (one a day's worth). */
export const WIDGET_HOURS = 24;

/** The index of the hour that contains `now` (the first hour that has not already ended). */
export function currentHourIndex(hourly: WxHour[], now: number): number {
  const i = hourly.findIndex((h) => Date.parse(h.time) + 3_600_000 > now);
  return i < 0 ? -1 : i;
}

function rainLine(hourly: WxHour[], from: number): string {
  const pops = hourly.slice(from, from + 24).map((h) => h.popPct).filter(isNum);
  if (!pops.length) return '';
  const max = Math.max(...pops);
  if (max < 20) return 'No rain expected';
  if (max < 40) return 'Small chance of rain';
  return `Rain chance ${Math.round(max)}%`;
}

export function buildWidgetEntries(data: WeatherPayload, now: number, leaf: string | null, locale = 'en-US'): WidgetEntry[] {
  const first = currentHourIndex(data.hourly, now);
  const highLow = (() => {
    const h = data.today?.highF; const l = data.today?.lowF;
    return isNum(h) || isNum(l) ? `H ${deg(h)}  L ${deg(l)}` : '';
  })();
  const gaugeOf = (t: number | null) => {
    const hi = data.today?.highF; const lo = data.today?.lowF;
    return isNum(t) && isNum(hi) && isNum(lo) && hi > lo ? { now: Math.max(lo, Math.min(hi, t)), low: lo, high: hi } : null;
  };

  // No hourly forecast at all: one entry from the current conditions, so the widget still shows something true.
  if (first < 0) {
    const c = data.current;
    const s = symbolOf(c?.icon);
    return [{
      date: new Date(now),
      props: {
        place: data.townName, temp: deg(c?.tempF), condition: c?.text || s.word, symbol: s.name, symbolColor: s.color, highLow, uv: '', rain: '',
        hours: [], leaf, gauge: gaugeOf(c?.tempF ?? null), link: WIDGET_LINK, company: WIDGET_NAME, colors: { ...widgetColors },
      },
    }];
  }

  const entries: WidgetEntry[] = [];
  for (let i = 0; i < WIDGET_HOURS && first + i < data.hourly.length; i++) {
    const idx = first + i;
    const h = data.hourly[idx];
    const s = symbolOf(i === 0 && data.current?.icon ? data.current.icon : h.icon);
    const strip: WidgetHour[] = [];
    // "Now", then the next odd hours (11 AM, 1 PM, 3 PM, 5 PM at 10:20), like the approved picture.
    for (let k = 0; k < 5; k++) {
      const hh = data.hourly[idx + (k === 0 ? 0 : 2 * k - 1)];
      if (!hh) break;
      strip.push({ label: k === 0 && i === 0 ? 'Now' : hourLabel(hh.time, locale), temp: deg(hh.tempF), symbol: symbolOf(hh.icon).name });
    }
    const temp = i === 0 && isNum(data.current?.tempF) ? data.current!.tempF : h.tempF;
    entries.push({
      date: new Date(i === 0 ? now : Date.parse(h.time)),
      props: {
        place: data.townName,
        temp: deg(temp),
        condition: i === 0 && data.current?.text ? data.current.text : s.word,
        symbol: s.name,
        symbolColor: s.color,
        highLow,
        uv: isNum(h.uvIndex) && h.uvIndex >= 1 ? `UV ${Math.round(h.uvIndex)}` : '',
        rain: rainLine(data.hourly, idx),
        hours: strip,
        leaf,
        link: WIDGET_LINK,
        company: WIDGET_NAME,
        colors: { ...widgetColors },
        gauge: gaugeOf(temp ?? null),
      },
    });
  }
  return entries;
}
