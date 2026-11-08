/**
 * AppNotSetUpScreen — shown by a RELEASE build that was made without its Supabase address/key.
 *
 * A release build never falls back to demo mode or sample data (src/lib/supabase.ts isAppNotSetUp). Instead the whole app shows
 * this one plain screen, so nobody mistakes an unconfigured build for a working one. Fix: set EXPO_PUBLIC_SUPABASE_URL and
 * EXPO_PUBLIC_SUPABASE_ANON_KEY in the build's EAS environment (and in the web host for the web site), then build again.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/providers/ThemeProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { spacing } from '@/theme/spacing';

export const APP_NOT_SET_UP_TITLE = 'App not set up';
export const APP_NOT_SET_UP_TEXT =
  "This app is missing its setup, so it can't sign you in or show any information yet. Please contact the company that gave you this app.";

export function AppNotSetUpScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}
      accessibilityRole="alert"
    >
      <EmptyState icon="alert-circle" title={APP_NOT_SET_UP_TITLE} description={APP_NOT_SET_UP_TEXT} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
});
