/**
 * EmptyState — Zero-data Placeholder
 *
 * Shown when a list or section has no content yet.
 * Professional and encouraging — not a dead-end.
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Icon } from './Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, sizing } from '@/theme/spacing';
import { Button } from './Button';

interface EmptyStateProps {
  icon?: keyof typeof Feather.glyphMap;
  title: string;
  description?: string;
  actionTitle?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  actionTitle,
  onAction,
  style,
}: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, style]}>
      <View style={[styles.iconContainer, { backgroundColor: colors.backgroundTertiary }]}>
        <Icon name={icon} size={sizing.iconXl} color={colors.textTertiary} />
      </View>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
      {description && (
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          {description}
        </Text>
      )}
      {actionTitle && onAction && (
        <Button
          title={actionTitle}
          onPress={onAction}
          variant="secondary"
          size="sm"
          style={styles.action}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['3xl'],
    gap: spacing.md,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    ...typeScale.headingSmall,
    textAlign: 'center',
  },
  description: {
    ...typeScale.bodySmall,
    textAlign: 'center',
    maxWidth: 280,
  },
  action: {
    marginTop: spacing.sm,
  },
});
