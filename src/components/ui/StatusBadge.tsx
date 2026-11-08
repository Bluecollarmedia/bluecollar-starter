/**
 * StatusBadge — Status Indicator
 *
 * Compact label for showing state: scheduled, in-progress, complete, etc.
 * Uses semantic colors so status meaning is immediately clear.
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { radius, spacing } from '@/theme/spacing';
import { semantic } from '@/theme/colors';

type StatusType = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface StatusBadgeProps {
  label: string;
  status?: StatusType;
  style?: ViewStyle;
}

const statusColors: Record<StatusType, { bg: string; text: string }> = {
  success: { bg: semantic.successLight, text: semantic.success },
  warning: { bg: semantic.warningLight, text: semantic.warning },
  error: { bg: semantic.errorLight, text: semantic.error },
  info: { bg: semantic.infoLight, text: semantic.info },
  neutral: { bg: '#F5F5F5', text: '#757575' },
};

export function StatusBadge({ label, status = 'neutral', style }: StatusBadgeProps) {
  const palette = statusColors[status];

  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }, style]}>
      <View style={[styles.dot, { backgroundColor: palette.text }]} />
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    gap: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    ...typeScale.caption,
    fontWeight: '600',
  },
});
