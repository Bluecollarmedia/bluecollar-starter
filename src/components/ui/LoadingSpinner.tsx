/**
 * LoadingSpinner — Loading State
 *
 * Centered loading indicator with optional message.
 * Used for full-screen loading, inline loading, and pull-to-refresh.
 */

import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

interface LoadingSpinnerProps {
  message?: string;
  size?: 'small' | 'large';
  fullScreen?: boolean;
  style?: ViewStyle;
}

export function LoadingSpinner({
  message,
  size = 'large',
  fullScreen = false,
  style,
}: LoadingSpinnerProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.container,
        fullScreen && styles.fullScreen,
        { backgroundColor: fullScreen ? colors.background : 'transparent' },
        style,
      ]}
    >
      <ActivityIndicator size={size} color={colors.primary} />
      {message && (
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          {message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['2xl'],
    gap: spacing.md,
  },
  fullScreen: {
    flex: 1,
  },
  message: {
    ...typeScale.bodySmall,
    textAlign: 'center',
  },
});
