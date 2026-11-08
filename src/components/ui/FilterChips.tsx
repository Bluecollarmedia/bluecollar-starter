import React from 'react';
import { ScrollView, Pressable, Text, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { radius, spacing } from '@/theme/spacing';

interface FilterOption<T extends string> {
  key: T;
  label: string;
  count?: number;
}

interface FilterChipsProps<T extends string> {
  options: FilterOption<T>[];
  selected: T;
  onSelect: (key: T) => void;
  style?: ViewStyle;
}

export function FilterChips<T extends string>({ options, selected, onSelect, style }: FilterChipsProps<T>) {
  const { colors } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.container, style]}
    >
      {options.map((option) => {
        const isActive = option.key === selected;
        return (
          <Pressable
            key={option.key}
            onPress={() => onSelect(option.key)}
            style={[
              styles.chip,
              {
                backgroundColor: isActive ? colors.primary : colors.backgroundTertiary,
                borderColor: isActive ? colors.primary : colors.borderLight,
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            <Text
              style={[
                styles.chipText,
                { color: isActive ? colors.textOnPrimary : colors.textSecondary },
              ]}
            >
              {option.label}
              {option.count !== undefined ? ` (${option.count})` : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipText: {
    ...typeScale.labelSmall,
  },
});
