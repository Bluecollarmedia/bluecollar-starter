import React from 'react';
import { ScrollView, Pressable, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/providers/ThemeProvider';
import { haptics } from '@/lib/haptics';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

/** Day cards for a list ("22 Thu"): tap one to show only that day; tap it again, or "All", to show everything. */
export function DateStrip({ dates, selected, onSelect, allLabel = 'All' }: { dates: string[]; selected: string | null; onSelect: (date: string | null) => void; allLabel?: string }) {
  const { colors } = useTheme();
  if (!dates.length) return null;
  const chip = (key: string, top: string, big: string, on: boolean, onPress: () => void, label: string) => (
    <Pressable
      key={key}
      onPress={() => { haptics.select(); onPress(); }}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      style={[styles.chip, { backgroundColor: on ? colors.primary : colors.backgroundTertiary }]}
    >
      <Text style={[typeScale.caption, { color: on ? 'rgba(255,255,255,0.85)' : colors.textSecondary }]}>{top}</Text>
      <Text style={[typeScale.headingSmall, { color: on ? '#FFFFFF' : colors.textPrimary }]}>{big}</Text>
    </Pressable>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {chip('all', '', allLabel, selected === null, () => onSelect(null), allLabel)}
      {dates.map((d) => {
        const day = new Date(`${d}T12:00:00`);
        return chip(d, day.toLocaleDateString('en-US', { weekday: 'short' }), String(day.getDate()), selected === d, () => onSelect(selected === d ? null : d), day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }));
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs },
  chip: { minWidth: 56, height: 64, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
});
