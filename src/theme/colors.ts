/**
 * Design System — Color Tokens
 *
 * THE PLAIN LOOK: white pages, light gray cards and borders, near-black text, and buttons in the ONE brand color from the settings
 * file (src/config/brand.js, look.brandColor; charcoal #2B2B2B by default). Green, red and amber appear only where they MEAN something:
 * green = done / approved / on the clock, red = error / late / declined / delete, amber = warning / needs attention.
 *
 * Every color the app shows comes from this folder (src/theme). Screens ask for colors by name (colors.primary, colors.textSecondary,
 * tones.success.fg, fixed.white ...). scripts/checks/plainLook.check.cjs fails if a typed-in color code appears anywhere else.
 */
import { brand as brandSettings } from '@/config/brand';

const HEX = /^#?([0-9a-f]{6})$/i;
const toRgb = (hex: string): [number, number, number] => {
  const m = HEX.exec(hex.trim());
  const n = parseInt(m ? m[1] : '2B2B2B', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb: number[]): string => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
/** The color moved part of the way (0 to 1) toward another color: toward white makes it lighter, toward black darker. */
export const mixColor = (hex: string, toward: string, amount: number): string => {
  const a = toRgb(hex);
  const b = toRgb(toward);
  return toHex(a.map((v, i) => v + (b[i] - v) * amount));
};
/** A 6-digit color with some see-through (0 to 1), for soft tints. */
export const withAlpha = (hex: string, alpha: number): string => {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
/** A 6-digit color as three 0-to-1 numbers (for the PDF library's rgb()). */
export const unitRgb = (hex: string): [number, number, number] => {
  const [r, g, b] = toRgb(hex);
  return [r / 255, g / 255, b / 255];
};
/** White with see-through (0 to 1): text and buttons over photos and dark screens. Safe inside animations. */
export const whiteAlpha = (alpha: number): string => {
  'worklet';
  return `rgba(255, 255, 255, ${alpha})`;
};
/** Black with see-through (0 to 1): dimmed backdrops behind sheets, shades over photos. Safe inside animations. */
export const blackAlpha = (alpha: number): string => {
  'worklet';
  return `rgba(0, 0, 0, ${alpha})`;
};

/** How bright a color looks (0 = black, 1 = white), as the contrast rules (WCAG) measure it. */
const luminance = (hex: string): number =>
  toRgb(hex)
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    })
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
/** The contrast between two colors (1 to 21). Text needs at least 4.5. */
export const contrastRatio = (a: string, b: string): number => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** The one brand color from the settings (a 6-digit hex code), normalised. */
export const BRAND_COLOR = toHex(toRgb(brandSettings.look.brandColor));

// ── Fixed colors (the same whatever the theme) ───────────────────
export const fixed = {
  white: '#FFFFFF',
  black: '#000000',
  /** Near-black page behind full-screen photo viewers and croppers. */
  viewer: '#111111',
  /** Soft light gray text on those dark screens. */
  viewerMuted: '#BBBBBB',
  /** Errors and "Delete" on those dark screens (a light red that reads on black). */
  errorOnDark: '#FF8A80',
} as const;

/** White text on the brand color when it is dark enough to read; near-black text on a light brand color. */
const ON_BRAND = contrastRatio(BRAND_COLOR, fixed.white) >= 4.5 ? fixed.white : '#111111';

// ── Brand Palette (from look.brandColor) ─────────────────────────
export const brand = {
  /** Primary — the brand color. Main buttons, selected tabs, links and small highlights. */
  primary: BRAND_COLOR,
  /** Lighter tone for hover / disabled primary */
  primaryLight: mixColor(BRAND_COLOR, '#FFFFFF', 0.25),
  /** Darker for pressed states */
  primaryDark: mixColor(BRAND_COLOR, '#000000', 0.3),
  /** Quiet light fill for tiles, chips and selected backgrounds (a whisper of the brand color) */
  primarySurface: mixColor(BRAND_COLOR, '#FFFFFF', 0.9),
  /** A deep shade of the brand color — for headings & strong text */
  accent: mixColor(BRAND_COLOR, '#000000', 0.4),
  /** A medium shade of the brand color */
  accentMid: mixColor(BRAND_COLOR, '#FFFFFF', 0.15),
  /** Text and icons on top of the brand color */
  onPrimary: ON_BRAND,
} as const;

// ── Neutral Palette ──────────────────────────────────────────────
export const neutral = {
  white: '#FFFFFF',
  gray50: '#FAFAFA',
  gray100: '#F5F5F5',
  gray200: '#EEEEEE',
  gray300: '#E5E5E5',
  gray400: '#BDBDBD',
  gray500: '#8A8A8A',
  gray600: '#6B6B6B',
  gray700: '#555555',
  gray800: '#3D3D3D',
  gray900: '#111111',
  black: '#000000',
} as const;

// ── Semantic Colors (meaning only) ───────────────────────────────
// Each strong color reads as text on white and on the light gray cards (contrast 4.5 or more).
export const semantic = {
  /** Done, approved, on the clock. */
  success: '#1E7B34',
  successLight: '#E8F5EC',
  /** Needs attention, pending, running late soon. */
  warning: '#A15C00',
  warningLight: '#FFF4E5',
  /** Error, late, declined, delete. */
  error: '#C62828',
  errorLight: '#FDECEC',
  /** Pressed state of red (delete) buttons. */
  errorDark: '#9F1F1F',
  /** Plain information: neutral, not a color of its own. */
  info: '#4A4A4A',
  infoLight: '#EEEEEE',
} as const;

/** Foreground + background pairs for status pills, badges and icon tiles. Only success / warning / error carry color. */
export const tones = {
  success: { fg: semantic.success, bg: semantic.successLight },
  warning: { fg: semantic.warning, bg: semantic.warningLight },
  error: { fg: semantic.error, bg: semantic.errorLight },
  neutral: { fg: neutral.gray600, bg: neutral.gray200 },
  /** Strong neutral: icons that should stand out without a color. */
  strong: { fg: neutral.gray900, bg: neutral.gray200 },
  brand: { fg: BRAND_COLOR, bg: mixColor(BRAND_COLOR, '#FFFFFF', 0.88) },
} as const;
export type ToneName = keyof typeof tones;

/** Muted colors to tell people and crews apart (avatar initials, crew dots): the brand color plus charcoal tints. All take white text. */
export const swatches: readonly string[] = [BRAND_COLOR, '#555555', '#4A4F57', '#5A5249', '#45524D', '#534A5A', '#6B6B6B', '#3D3D3D'];

/** Colors of the printed / emailed quotes, invoices and material lists (HTML and PDF). */
export const documentColors = {
  ink: '#111111',
  muted: '#5C5C5C',
  faint: '#8A8A8A',
  rule: '#E5E5E5',
  soft: '#F5F5F5',
  page: '#FFFFFF',
  /** The faint "VOID" / "DECLINED" stamp across a page. */
  stamp: withAlpha(semantic.error, 0.1),
  heading: BRAND_COLOR,
} as const;

/** Maps: the drawn map card's background and the check-in zone around a job site. */
export const mapColors = {
  tint: '#ECECEC',
  zoneFill: withAlpha(BRAND_COLOR, 0.14),
} as const;

// ── Light Theme ──────────────────────────────────────────────────
export const lightTheme = {
  // Backgrounds: white page, light gray cards
  background: '#FFFFFF',
  backgroundSecondary: '#FAFAFA',
  backgroundTertiary: '#F2F2F2',
  surface: '#F5F5F5',
  surfaceElevated: '#FFFFFF',
  surfacePressed: '#EBEBEB',

  // Text: near-black
  textPrimary: '#111111',
  textSecondary: '#6B6B6B',
  textTertiary: '#8A8A8A',
  textInverse: neutral.white,
  textOnPrimary: brand.onPrimary,

  // Borders
  border: '#E5E5E5',
  borderLight: '#EEEEEE',
  borderFocus: brand.primary,
  /** Hairline row/list separators */
  separator: 'rgba(0, 0, 0, 0.12)',
  /** Screen background behind grouped list sections (the white page) */
  groupedBackground: '#FFFFFF',

  // Interactive
  primary: brand.primary,
  primaryLight: brand.primaryLight,
  primaryDark: brand.primaryDark,
  primarySurface: brand.primarySurface,

  // Semantic
  success: semantic.success,
  successLight: semantic.successLight,
  warning: semantic.warning,
  warningLight: semantic.warningLight,
  error: semantic.error,
  errorLight: semantic.errorLight,
  info: semantic.info,
  infoLight: semantic.infoLight,

  // Overlays
  overlay: 'rgba(0, 0, 0, 0.5)',
  scrim: 'rgba(0, 0, 0, 0.32)',

  // Shadows
  shadowColor: neutral.black,
} as const;

// ── Dark Theme (not switched on: the app is light only, app.json userInterfaceStyle "light") ──
export const darkTheme = {
  background: '#121212',
  backgroundSecondary: '#1A1A1A',
  backgroundTertiary: '#262626',
  surface: '#1E1E1E',
  surfaceElevated: '#2A2A2A',
  surfacePressed: '#2A2A2A',

  textPrimary: '#F5F5F5',
  textSecondary: '#BDBDBD',
  textTertiary: '#9E9E9E',
  textInverse: neutral.gray900,
  textOnPrimary: brand.onPrimary,

  border: '#333333',
  borderLight: '#2A2A2A',
  borderFocus: brand.primaryLight,
  separator: 'rgba(255, 255, 255, 0.14)',
  groupedBackground: '#121212',

  primary: brand.primaryLight,
  primaryLight: brand.primary,
  primaryDark: brand.primaryDark,
  primarySurface: withAlpha(BRAND_COLOR, 0.18),

  // Semantic
  success: '#4CAF68',
  successLight: '#163A21',
  warning: '#E0A040',
  warningLight: '#3D2C0D',
  error: '#EF5350',
  errorLight: '#4A1515',
  info: '#BDBDBD',
  infoLight: '#2A2A2A',

  overlay: 'rgba(0, 0, 0, 0.7)',
  scrim: 'rgba(0, 0, 0, 0.5)',

  shadowColor: neutral.black,
} as const;

// Use a widened type so both light and dark themes satisfy the same interface
export type ThemeColors = { [K in keyof typeof lightTheme]: string };
