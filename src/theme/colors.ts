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

// ── Readable on ANY brand color ──────────────────────────────────
// Text needs a contrast of 4.5 : 1 or more (WCAG AA). The owner can pick any brand color, light or dark, so the colors drawn ON it
// and the brand color drawn as text are worked out here, never assumed. Checked by scripts/checks/brandContrast.check.cjs.
const MIN_CONTRAST = 4.5;
const NEAR_BLACK = '#111111';
/** The text / icon color for something drawn ON this background: white when it reads (4.5 : 1), otherwise near-black (or pure
 *  black for the few middle colors where near-black falls just short). */
export const onColor = (bg: string): string => {
  if (contrastRatio(bg, fixed.white) >= MIN_CONTRAST) return fixed.white;
  return contrastRatio(bg, NEAR_BLACK) >= MIN_CONTRAST ? NEAR_BLACK : fixed.black;
};
/** The color darkened (only as much as needed) until it reads as text on every one of these light backgrounds. */
export const readableOn = (hex: string, backgrounds: readonly string[]): string => {
  for (let step = 0; step <= 20; step++) {
    const c = mixColor(hex, '#000000', step / 20);
    if (backgrounds.every((bg) => contrastRatio(c, bg) >= MIN_CONTRAST)) return c;
  }
  return fixed.black;
};
/** A pressed / second shade of a background that still reads with the same text color: darker when that works, else lighter. */
const shadeKeeping = (bg: string, text: string): string => {
  for (const amount of [0.3, 0.2, 0.1]) {
    const c = mixColor(bg, '#000000', amount);
    if (contrastRatio(c, text) >= MIN_CONTRAST) return c;
  }
  return mixColor(bg, '#FFFFFF', 0.25);
};

/** Any color (a crew color, a swatch) as text on the white page, the gray cards or its own faint tint: darkened when too light. */
export const readableOnLight = (hex: string): string => readableOn(hex, ['#FFFFFF', '#F5F5F5', mixColor(hex, '#FFFFFF', 0.85)]);

/** Text and icons on the brand color: white on a dark brand color, near-black on a light one (yellow, cyan, white...). */
const ON_BRAND = onColor(BRAND_COLOR);
const BRAND_SURFACE = mixColor(BRAND_COLOR, '#FFFFFF', 0.9);
const BRAND_TONE_BG = mixColor(BRAND_COLOR, '#FFFFFF', 0.88);
/** The light backgrounds brand-colored text sits on: the white page, the gray cards and the brand's own light tints. */
const LIGHT_BACKGROUNDS = ['#FFFFFF', '#FAFAFA', '#F5F5F5', '#F2F2F2', BRAND_SURFACE, BRAND_TONE_BG] as const;
/** The brand color as TEXT or an ICON on the white page / light cards (links, outlined buttons, selected labels): the brand color
 *  itself when it reads there, otherwise a darker shade of it. Never use plain primary for text. */
const BRAND_ON_WHITE = readableOn(BRAND_COLOR, LIGHT_BACKGROUNDS);

// ── Brand Palette (from look.brandColor) ─────────────────────────
export const brand = {
  /** Primary — the brand color. BACKGROUNDS: main buttons, selected chips and pills. Text on it = onPrimary. */
  primary: BRAND_COLOR,
  /** Lighter tone for borders and the disabled look (no text on it). */
  primaryLight: mixColor(BRAND_COLOR, '#FFFFFF', 0.25),
  /** A deep shade of the brand color: text and icons on light backgrounds, or a background for white text (it reads both ways). */
  primaryDark: readableOn(mixColor(BRAND_COLOR, '#000000', 0.3), LIGHT_BACKGROUNDS),
  /** Pressed state of a brand-color button, and the second color of brand gradients: still readable with onPrimary. */
  primaryPressed: shadeKeeping(BRAND_COLOR, ON_BRAND),
  /** The brand color as text / icons on white and light cards (see BRAND_ON_WHITE). */
  primaryOnWhite: BRAND_ON_WHITE,
  /** Quiet light fill for tiles, chips and selected backgrounds (a whisper of the brand color) */
  primarySurface: BRAND_SURFACE,
  /** A deep shade of the brand color — for headings & strong text */
  accent: readableOn(mixColor(BRAND_COLOR, '#000000', 0.4), LIGHT_BACKGROUNDS),
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
  brand: { fg: BRAND_ON_WHITE, bg: BRAND_TONE_BG },
} as const;
export type ToneName = keyof typeof tones;

/** Muted colors to tell people and crews apart (avatar initials, crew dots): the brand color plus charcoal tints. Text on one of
 *  them uses onColor(swatch) (the brand color may be light). */
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
  /** Headings in the brand color on the white page (darkened if the brand color is too light to read). */
  heading: BRAND_ON_WHITE,
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
  primaryPressed: brand.primaryPressed,
  /** The brand color as text / icons on the white page and light cards (readable for any brand color). */
  primaryOnWhite: brand.primaryOnWhite,
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
  primaryPressed: brand.primaryPressed,
  primaryOnWhite: brand.primaryLight,
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
