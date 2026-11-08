/**
 * Card — Surface Container
 *
 * Plain elevated surface for grouping related content. No border by
 * default — separation from the screen background comes from a subtle
 * shadow, not a colored outline. Use `accentColor` for a restrained
 * left-edge stripe when a card needs to signal priority/status; avoid
 * full colored borders.
 */

import React from 'react';
import { View, Pressable, Text, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { radius, spacing, shadow } from '@/theme/spacing';

interface CardProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  onPress?: () => void;
  style?: ViewStyle;
  noPadding?: boolean;
  /** Subtle left-edge stripe for priority/status signaling instead of a full border */
  accentColor?: string;
}

export function Card({ children, title, subtitle, onPress, style, noPadding, accentColor }: CardProps) {
  const { colors } = useTheme();

  const cardStyle: ViewStyle = {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    ...shadow.sm,
    ...(accentColor ? { borderLeftWidth: 3, borderLeftColor: accentColor } : {}),
    ...(noPadding ? {} : { padding: spacing.lg }),
  };

  const content = (
    <>
      {(title || subtitle) && (
        <View style={[styles.header, noPadding && styles.headerPadded]}>
          {title && (
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
              {title}
            </Text>
          )}
          {subtitle && (
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
              {subtitle}
            </Text>
          )}
        </View>
      )}
      {children}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [cardStyle, pressed && { opacity: 0.92 }, style]}
        accessibilityRole="button"
      >
        {content}
      </Pressable>
    );
  }

  return <View style={[cardStyle, style]}>{content}</View>;
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.md,
  },
  headerPadded: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
});
