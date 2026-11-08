/**
 * Weather colors (the forecast screens and the home-screen widget).
 *
 * The screens follow the plain look: white page, light gray panels, near-black text, the brand color for buttons and selected
 * things. The only other colors are the weather's own meaning colors, kept on purpose because they carry information:
 * the temperature and UV scales, rain blue, the sun and moon, and the round sky chips behind the weather pictures.
 */
import { BRAND_COLOR, brand, fixed, mixColor, semantic, withAlpha } from '@/theme/colors';

/** The weather screens' palette. */
export const WX = {
  /** The page behind everything (the plain hero picture fades into it). */
  page: '#FFFFFF',
  /** Panels (cards). */
  card: '#F5F5F5',
  /** Main text. */
  ink: '#111111',
  /** Buttons, selected tabs and chips: the brand color (text on it = onDeep). */
  deep: BRAND_COLOR,
  /** Strong text and icons in the brand color on the white page (darkened when the brand color is too light to read). */
  deepText: brand.primaryOnWhite,
  /** Secondary text. */
  soft: '#555555',
  /** Quiet labels. */
  faint: '#6B6B6B',
  /** The logo mark's tint and small highlights: the brand color. */
  leaf: brand.primaryOnWhite,
  /** Soft fill for pressed rows, selected tabs and read-outs. */
  leafTint: brand.primarySurface,
  /** Hairlines and panel borders. */
  line: '#E5E5E5',
  /** Warnings (weather alerts). */
  amber: semantic.warning,
  /** Rain chance (weather meaning). */
  rain: '#2A72B5',
  white: fixed.white,
  /** Text on the brand color. */
  onDeep: brand.onPrimary,
  /** Panel and floating bar shadow. */
  shadow: fixed.black,
  /** Sheet grab handle, empty bar tracks. */
  grip: '#D4D4D4',
  track: '#EBEBEB',
  /** Body text in a weather alert. */
  body: '#3D3D3D',
  /** A weather alert panel. */
  alertBg: semantic.warningLight,
  alertLine: mixColor(semantic.warning, '#FFFFFF', 0.7),
  /** The number on a selected (dark) tile when the value is switched off. */
  onDeepMuted: withAlpha(brand.onPrimary, 0.7),
} as const;

/** Weather meaning colors: scales, sun, moon and sky. Not decoration. */
export const wxArt = {
  /** Round chips behind the pale weather pictures: sky by day, deep blue at night, slate for storms. */
  chipDay: '#A9C9EA',
  chipNight: '#27375F',
  chipStorm: '#8EA3C4',
  chipSmoke: '#B8BEC6',
  chipDust: '#D6C7A6',
  /** UV index legend, low to extreme. */
  uvLegend: ['#3E9E52', '#E8C23A', '#F08A24', '#E0503A', '#8E3FBF'] as const,
  /** UV gauge needle. */
  uvMarker: '#F0A21A',
  /** Humidity legend, dry to muggy. */
  humidityLegend: ['#4A90E2', '#5CCB7A', '#F2D45C', '#EF6A5A'] as const,
  /** Chance-of-rain mini bars. */
  rainChance: '#6AA9DE',
  /** Rain bars in the charts. */
  rainBar: '#8EC3F0',
  /** Sun path: the part already travelled, and the rest. */
  sunDone: '#E8A21E',
  sunLeft: '#E0E0E0',
  /** The moon. */
  moon: '#D9B24A',
  /** A day with no data in the mini bars. */
  emptyBar: '#E0E0E0',
} as const;

/** Temperature color steps (degrees F): freezing blue to hot red. */
export const tempScale = {
  none: '#9E9E9E',
  freezing: '#5BB3F0',
  cold: '#3FBF9A',
  mild: '#7CC25A',
  warm: '#E8C23A',
  hot: '#EE8B3A',
  veryHot: '#E5604F',
} as const;

/** UV index steps, low to extreme (readable as text on white). */
export const uvScale = {
  none: '#6B6B6B',
  low: '#2E8B45',
  moderate: '#9C7500',
  high: '#C2620F',
  veryHigh: '#C2381F',
  extreme: '#8E3FBF',
} as const;

/** The SF Symbol colors in the home-screen widget, one per kind of weather. */
export const widgetSymbolColors = {
  sun: '#F2B632',
  moon: '#7C8FC0',
  partly: '#E0A93A',
  partlynight: '#7C8FC0',
  cloud: '#9E9E9E',
  drizzle: '#5F9BC9',
  rain: '#3F86C0',
  heavyrain: '#2F6FA8',
  storm: '#6A6FA8',
  snow: '#7FB2D9',
  heavysnow: '#5E9BD0',
  sleet: '#6C9CBF',
  hail: '#6C9CBF',
  fog: '#A0A0A0',
  haze: '#D2A857',
  smoke: '#8A8A8A',
  dust: '#C4A06A',
  wind: '#7A9A98',
} as const;

/** The widget's own palette (it cannot read the theme itself, so src/lib/widgetData.ts hands these over). Plain and light. */
export const widgetColors = {
  ink: '#111111',
  soft: '#555555',
  page: '#FFFFFF',
  accent: brand.primaryOnWhite,
  rule: '#E5E5E5',
} as const;
