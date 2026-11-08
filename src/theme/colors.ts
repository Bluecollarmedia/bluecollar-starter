/**
 * Design System — Color Tokens
 *
 * Brand palette: placeholder greens carried over from the original app.
 * A new client swaps these for their own brand color (Step 4 makes a plain default).
 * The darker greens are for headings and strong emphasis.
 */

// ── Brand Palette (placeholder) ──────────────────────────────────
export const brand = {
  /** Primary — deep forest green. Only for important actions and selected states. */
  primary: '#2D5A43',
  /** Lighter forest tone for hover / disabled primary */
  primaryLight: '#4E7B64',
  /** Darker for pressed states */
  primaryDark: '#1E4430',
  /** Quiet warm-neutral fill for tiles, chips and selected backgrounds (not green) */
  primarySurface: '#EDECE6',
  /** Deep forest green from the main wordmark — for headings & strong text */
  accent: '#1B3A2D',
  /** Medium green from the main logo lettering */
  accentMid: '#4A8B3F',
} as const;

// ── Neutral Palette ──────────────────────────────────────────────
export const neutral = {
  white: '#FFFFFF',
  gray50: '#FAFAFA',
  gray100: '#F5F5F5',
  gray200: '#EEEEEE',
  gray300: '#E0E0E0',
  gray400: '#BDBDBD',
  gray500: '#9E9E9E',
  gray600: '#757575',
  gray700: '#616161',
  gray800: '#424242',
  gray900: '#212121',
  black: '#000000',
} as const;

// ── Semantic Colors ──────────────────────────────────────────────
export const semantic = {
  success: '#43A047',
  successLight: '#E8F5E9',
  warning: '#F9A825',
  warningLight: '#FFF8E1',
  error: '#D32F2F',
  errorLight: '#FFEBEE',
  info: '#1976D2',
  infoLight: '#E3F2FD',
} as const;

// ── Light Theme ──────────────────────────────────────────────────
export const lightTheme = {
  // Backgrounds: warm off-white page, white cards
  background: '#F6F5F1',
  backgroundSecondary: '#FAF9F6',
  backgroundTertiary: '#EFEEE9',
  surface: neutral.white,
  surfaceElevated: neutral.white,
  surfacePressed: '#EFEEE9',

  // Text: charcoal
  textPrimary: '#1F2328',
  textSecondary: '#6A6E75',
  textTertiary: '#8D9096',
  textInverse: neutral.white,
  textOnPrimary: neutral.white,

  // Borders
  border: '#E3E1DA',
  borderLight: '#ECEAE4',
  borderFocus: brand.primary,
  /** Hairline row/list separators */
  separator: 'rgba(60, 55, 45, 0.2)',
  /** Screen background behind grouped list sections (same warm off-white) */
  groupedBackground: '#F6F5F1',

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

// ── Dark Theme (future use) ──────────────────────────────────────
export const darkTheme = {
  background: '#121212',
  backgroundSecondary: '#1E1E1E',
  backgroundTertiary: '#2C2C2C',
  surface: '#1E1E1E',
  surfaceElevated: '#2C2C2C',
  surfacePressed: '#2A2A2A',

  textPrimary: '#F5F5F5',
  textSecondary: '#BDBDBD',
  textTertiary: '#9E9E9E',
  textInverse: neutral.gray900,
  textOnPrimary: neutral.white,

  border: '#333333',
  borderLight: '#2C2C2C',
  borderFocus: brand.primaryLight,
  separator: 'rgba(84, 84, 88, 0.6)',
  groupedBackground: '#000000',

  primary: brand.primaryLight,
  primaryLight: brand.primary,
  primaryDark: brand.primaryDark,
  primarySurface: 'rgba(76, 175, 80, 0.12)',

  // Semantic
  success: semantic.success,
  successLight: '#1B5E20',
  warning: semantic.warning,
  warningLight: '#4A3800',
  error: '#EF5350',
  errorLight: '#4A1515',
  info: '#42A5F5',
  infoLight: '#0D3B66',

  overlay: 'rgba(0, 0, 0, 0.7)',
  scrim: 'rgba(0, 0, 0, 0.5)',

  shadowColor: neutral.black,
} as const;

// Use a widened type so both light and dark themes satisfy the same interface
export type ThemeColors = { [K in keyof typeof lightTheme]: string };
