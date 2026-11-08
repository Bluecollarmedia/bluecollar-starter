/**
 * Design System — Spacing, Sizing & Shape
 *
 * 4px base unit. Generous spacing keeps the interface clean
 * and breathable — critical for a professional impression.
 */

// ── Spacing Scale (4px base) ─────────────────────────────────────
export const spacing = {
  /** 2px — hairline gaps */
  '2xs': 2,
  /** 4px — tight internal padding */
  xs: 4,
  /** 8px — compact spacing */
  sm: 8,
  /** 12px — standard internal padding */
  md: 12,
  /** 16px — standard gap between elements */
  lg: 16,
  /** 20px — section internal padding */
  xl: 20,
  /** 24px — generous padding */
  '2xl': 24,
  /** 32px — section gaps */
  '3xl': 32,
  /** 40px — large section gaps */
  '4xl': 40,
  /** 48px — page-level spacing */
  '5xl': 48,
  /** 64px — major separations */
  '6xl': 64,
} as const;

// ── Border Radius ────────────────────────────────────────────────
export const radius = {
  /** 0px — sharp corners */
  none: 0,
  /** 4px — subtle rounding */
  xs: 4,
  /** 8px — standard card/input radius */
  sm: 8,
  /** 12px — prominent rounding */
  md: 12,
  /** 16px — large cards, modals */
  lg: 16,
  /** 20px — extra rounded */
  xl: 20,
  /** 9999px — pill / fully round */
  full: 9999,
} as const;

// ── Shadows ──────────────────────────────────────────────────────
// Subtle, professional elevation. iOS uses shadow*, Android uses elevation.
import { Platform, ViewStyle } from 'react-native';

export const shadow = {
  none: Platform.select<ViewStyle>({
    ios: { shadowOpacity: 0 },
    android: { elevation: 0 },
    default: { shadowOpacity: 0 },
  })!,

  /** Subtle lift — cards, inputs */
  sm: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.03,
      shadowRadius: 2,
    },
    android: { elevation: 0 },
    default: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.03,
      shadowRadius: 2,
    },
  })!,

  /** Standard elevation — floating elements */
  md: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 6,
    },
    android: { elevation: 1 },
    default: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 6,
    },
  })!,

  /** Strong elevation — modals, popovers */
  lg: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 16,
    },
    android: { elevation: 8 },
    default: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 16,
    },
  })!,
} as const;

// ── Sizing ───────────────────────────────────────────────────────
export const sizing = {
  /** Touch target minimum (44pt iOS guideline) */
  touchTarget: 44,
  /** Standard button height */
  buttonHeight: 48,
  /** Small button height */
  buttonHeightSm: 36,
  /** Large button height */
  buttonHeightLg: 56,
  /** Standard input height */
  inputHeight: 48,
  /** Icon sizes */
  iconSm: 16,
  iconMd: 20,
  iconLg: 24,
  iconXl: 32,
  /** Avatar sizes */
  avatarSm: 32,
  avatarMd: 40,
  avatarLg: 56,
  avatarXl: 80,
  /** Header heights */
  headerHeight: 56,
  /** Tab bar height */
  tabBarHeight: 56,
  /** Max content width for web/tablet */
  maxContentWidth: 600,
  /** Max content width for wide layouts */
  maxWideWidth: 1200,
} as const;
