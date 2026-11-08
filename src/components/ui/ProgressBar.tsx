import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { radius, spacing } from '@/theme/spacing';

interface ProgressBarProps {
  progress: number;
  showLabel?: boolean;
  height?: number;
  style?: ViewStyle;
}

export function ProgressBar({ progress, showLabel = false, height = 6, style }: ProgressBarProps) {
  const { colors } = useTheme();
  const clamped = Math.max(0, Math.min(100, progress));

  return (
    <View style={[styles.container, style]}>
      <View style={[styles.track, { height, backgroundColor: colors.backgroundTertiary }]}>
        <View
          style={[
            styles.fill,
            {
              height,
              width: `${clamped}%`,
              backgroundColor: clamped >= 100 ? '#43A047' : colors.primary,
            },
          ]}
        />
      </View>
      {showLabel && (
        <Text style={[styles.label, { color: colors.textSecondary }]}>{clamped}%</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  track: {
    flex: 1,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  fill: {
    borderRadius: radius.full,
  },
  label: {
    ...typeScale.caption,
    fontWeight: '600',
    minWidth: 32,
    textAlign: 'right',
  },
});
