/**
 * List — Native Grouped List (iOS Settings-style)
 *
 * ListSection groups related ListRows into a single surface with
 * hairline separators between rows — no per-row borders or shadows.
 * This replaces the pattern of wrapping every option in its own
 * bordered rounded rectangle.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Icon } from './Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow, sizing } from '@/theme/spacing';

interface ListSectionProps {
  title?: string;
  footer?: string;
  children: React.ReactNode;
  style?: ViewStyle;
}

export function ListSection({ title, footer, children, style }: ListSectionProps) {
  const { colors } = useTheme();
  const items = React.Children.toArray(children).filter(Boolean);

  return (
    <View style={[styles.sectionWrap, style]}>
      {title && (
        <Text
          style={[
            typeScale.overline,
            { color: colors.textTertiary, marginBottom: spacing.xs, marginLeft: spacing.md },
          ]}
        >
          {title}
        </Text>
      )}
      <View style={[styles.section, { backgroundColor: colors.surface }, shadow.sm]}>
        {items.map((child, i) => (
          <React.Fragment key={i}>
            {child}
            {i < items.length - 1 && (
              <View style={[styles.separator, { backgroundColor: colors.separator }]} />
            )}
          </React.Fragment>
        ))}
      </View>
      {footer && (
        <Text
          style={[
            typeScale.caption,
            { color: colors.textTertiary, marginTop: spacing.xs, marginLeft: spacing.md },
          ]}
        >
          {footer}
        </Text>
      )}
    </View>
  );
}

interface ListRowProps {
  icon?: keyof typeof Feather.glyphMap;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value?: string;
  selected?: boolean;
  showChevron?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  rightElement?: React.ReactNode;
}

export function ListRow({
  icon,
  iconColor,
  title,
  subtitle,
  value,
  selected,
  showChevron,
  destructive,
  disabled,
  onPress,
  rightElement,
}: ListRowProps) {
  const { colors } = useTheme();
  const titleColor = destructive ? colors.error : disabled ? colors.textTertiary : colors.textPrimary;

  const content = (
    <View style={[styles.row, disabled && { opacity: 0.5 }]}>
      {icon && (
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: iconColor ? `${iconColor}1A` : colors.primarySurface },
          ]}
        >
          <Icon name={icon} size={16} color={iconColor ?? colors.primary} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.bodyLarge, { color: titleColor }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 1 }]} numberOfLines={value ? 1 : 2}>
            {subtitle}
          </Text>
        )}
      </View>
      {value && (
        <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]} numberOfLines={1}>
          {value}
        </Text>
      )}
      {rightElement}
      {selected && <Icon name="check" size={18} color={colors.primary} />}
      {showChevron && onPress && <Icon name="chevron-right" size={18} color={colors.textTertiary} />}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [pressed && { backgroundColor: colors.backgroundSecondary }]}
        accessibilityRole="button"
      >
        {content}
      </Pressable>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  sectionWrap: { marginBottom: spacing.lg },
  section: { borderRadius: radius.xl, overflow: 'hidden' },
  // Inset past the icon circle, like iOS Settings.
  separator: { height: StyleSheet.hairlineWidth, marginLeft: spacing.md + 32 + spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: sizing.touchTarget,
    gap: spacing.sm,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
