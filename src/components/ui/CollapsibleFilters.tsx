/**
 * Filters that stay out of the way: one small "Filters" button (with a count when any are on). Tap it and each filter group shows
 * its options; tap it again and they fold back up. Used wherever a list had several rows of filter chips on screen at once.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { Icon } from './Icon';
import { FilterChips } from './FilterChips';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { radius, spacing } from '@/theme/spacing';

export interface FilterGroup {
  key: string;
  label: string;
  options: { key: string; label: string; count?: number }[];
  selected: string;
  onSelect: (key: string) => void;
  /** The "nothing chosen" option (default: the first one). A group on any other option counts as a filter that is on. */
  defaultKey?: string;
}

const defaultOf = (g: FilterGroup) => g.defaultKey ?? g.options[0]?.key;

export function CollapsibleFilters({ groups, style, startOpen = false }: { groups: FilterGroup[]; style?: ViewStyle; startOpen?: boolean }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(startOpen);
  const active = groups.filter((g) => g.selected !== defaultOf(g));

  return (
    <View style={style}>
      <View style={styles.bar}>
        <Pressable
          onPress={() => setOpen(!open)}
          style={[styles.button, {
            backgroundColor: active.length > 0 ? colors.primary : open ? colors.primarySurface : colors.backgroundTertiary,
            borderColor: active.length > 0 || open ? colors.primary : colors.borderLight,
          }]}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={active.length > 0 ? `Filters, ${active.length} on. Tap to ${open ? 'hide' : 'change'}` : `Filters. Tap to ${open ? 'hide' : 'show'}`}
        >
          <Icon name="sliders" size={14} color={active.length > 0 ? colors.textOnPrimary : colors.textSecondary} />
          <Text style={[typeScale.labelSmall, { color: active.length > 0 ? colors.textOnPrimary : colors.textPrimary }]}>
            {active.length > 0 ? `Filters · ${active.length}` : 'Filters'}
          </Text>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={active.length > 0 ? colors.textOnPrimary : colors.textSecondary} />
        </Pressable>
        {active.length > 0 ? (
          <Pressable onPress={() => groups.forEach((g) => g.onSelect(defaultOf(g)))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear all filters">
            <Text style={[typeScale.labelSmall, { color: colors.primary }]}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {open ? groups.map((g) => (
        <View key={g.key}>
          <Text style={[typeScale.overline, styles.label, { color: colors.textTertiary }]}>{g.label.toUpperCase()}</Text>
          <FilterChips options={g.options} selected={g.selected} onSelect={g.onSelect} />
        </View>
      )) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  button: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, minHeight: 36, borderRadius: radius.full, borderWidth: 1 },
  label: { marginTop: spacing.sm, marginBottom: 2, marginLeft: spacing.xs },
});
