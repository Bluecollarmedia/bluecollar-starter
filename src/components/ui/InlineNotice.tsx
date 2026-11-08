/**
 * InlineNotice — Compact status/notice row
 *
 * Replaces one-off "banner" styles (truck, offline, reminders, photo
 * requirement) with a single restrained pattern: icon + text on a
 * tinted background, no border, no shadow.
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Icon } from './Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

type NoticeTone = 'info' | 'warning' | 'success' | 'error' | 'neutral';

interface InlineNoticeProps {
  icon: keyof typeof Feather.glyphMap;
  text: string;
  tone?: NoticeTone;
  style?: ViewStyle;
}

export function InlineNotice({ icon, text, tone = 'info', style }: InlineNoticeProps) {
  const { colors } = useTheme();

  const toneColors: Record<NoticeTone, { bg: string; fg: string }> = {
    info: { bg: colors.infoLight, fg: colors.info },
    warning: { bg: colors.warningLight, fg: colors.warning },
    success: { bg: colors.successLight, fg: colors.success },
    error: { bg: colors.errorLight, fg: colors.error },
    neutral: { bg: colors.backgroundTertiary, fg: colors.textSecondary },
  };
  const palette = toneColors[tone];

  return (
    <View style={[styles.wrap, { backgroundColor: palette.bg }, style]}>
      <Icon name={icon} size={14} color={palette.fg} />
      <Text style={[typeScale.caption, { color: palette.fg, flex: 1 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
});
