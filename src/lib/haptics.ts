/**
 * Centralized haptic feedback — thin wrapper over expo-haptics so call
 * sites read as intent ("confirm", "success") rather than raw style
 * enums, and so haptics degrade silently on platforms without support
 * (web) instead of every call site needing its own try/catch.
 */
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

function safe(fn: () => Promise<void>) {
  if (Platform.OS === 'web') return;
  fn().catch(() => {});
}

export const haptics = {
  /** Light tap for a routine selection (filter chip, tab, list row). */
  select: () => safe(() => Haptics.selectionAsync()),
  /** A lightweight confirmation — task started, item toggled. */
  light: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** A meaningful state change — check-in/out, schedule confirmed, task completed. */
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** A warning-level nudge — schedule conflict, offline action queued. */
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  /** Before a destructive confirmation fires (deactivate, decline, cancel). */
  destructive: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
