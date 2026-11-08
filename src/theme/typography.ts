/**
 * Design System — Typography
 *
 * Clean, professional type hierarchy using the system font stack.
 * We rely on the platform's native typeface (San Francisco on iOS,
 * Roboto on Android, system sans-serif on web) for maximum clarity
 * and a "belongs on this device" feeling.
 *
 * If a custom brand font is provided later, only `fontFamily` changes.
 */

import { Platform, TextStyle } from 'react-native';

// ── Font Families ────────────────────────────────────────────────
export const fontFamily = {
  regular: Platform.select({
    ios: 'System',
    android: 'Roboto',
    web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    default: 'System',
  }) as string,
  medium: Platform.select({
    ios: 'System',
    android: 'Roboto',
    web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    default: 'System',
  }) as string,
  semibold: Platform.select({
    ios: 'System',
    android: 'Roboto',
    web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    default: 'System',
  }) as string,
  bold: Platform.select({
    ios: 'System',
    android: 'Roboto',
    web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    default: 'System',
  }) as string,
};

// ── Font Weights ─────────────────────────────────────────────────
export const fontWeight = {
  regular: '400' as TextStyle['fontWeight'],
  medium: '500' as TextStyle['fontWeight'],
  semibold: '600' as TextStyle['fontWeight'],
  bold: '700' as TextStyle['fontWeight'],
};

// ── Type Scale ───────────────────────────────────────────────────
// Each level defines size + lineHeight + weight for consistency.
export const typeScale = {
  /** Page titles, splash headings */
  displayLarge: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.bold,
    letterSpacing: -0.5,
  } satisfies TextStyle,

  /** Section titles */
  displaySmall: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.bold,
    letterSpacing: -0.25,
  } satisfies TextStyle,

  /** Card titles, dialog headers */
  headingLarge: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.semibold,
    letterSpacing: 0,
  } satisfies TextStyle,

  /** Sub-section headings */
  headingSmall: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.semibold,
    letterSpacing: 0,
  } satisfies TextStyle,

  /** Primary body text */
  bodyLarge: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: fontWeight.regular,
    fontFamily: fontFamily.regular,
    letterSpacing: 0.15,
  } satisfies TextStyle,

  /** Body text between bodyLarge and bodySmall (worker screens use it). */
  bodyMedium: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: fontWeight.regular,
    fontFamily: fontFamily.regular,
    letterSpacing: 0.1,
  } satisfies TextStyle,

  /** Secondary body text */
  bodySmall: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: fontWeight.regular,
    fontFamily: fontFamily.regular,
    letterSpacing: 0.1,
  } satisfies TextStyle,

  /** Button labels */
  labelLarge: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.semibold,
    letterSpacing: 0.1,
  } satisfies TextStyle,

  /** Small labels, tab labels */
  labelSmall: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeight.medium,
    fontFamily: fontFamily.medium,
    letterSpacing: 0.4,
  } satisfies TextStyle,

  /** Captions, helper text, timestamps */
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeight.regular,
    fontFamily: fontFamily.regular,
    letterSpacing: 0.3,
  } satisfies TextStyle,

  /** Fine print, legal */
  overline: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: fontWeight.medium,
    fontFamily: fontFamily.medium,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  } satisfies TextStyle,
} as const;
