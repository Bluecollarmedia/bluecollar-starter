/**
 * MenuGroup / MenuRow — flat, full-width list rows used on the owner's
 * More tab.
 *
 * Each row has a warm-neutral circle with a charcoal line icon, a label, an
 * optional subtitle and count pill, and a chevron. Rows are separated by a
 * thin hairline that starts at the row's text; each group ends with a
 * full-width hairline. No cards, gradients or shadows.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Icon } from './Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { haptics } from '@/lib/haptics';

const ICON_CIRCLE = 36;

export function MenuGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  const rows = React.Children.toArray(children).filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <View>
      {!!title && (
        <Text style={[typeScale.overline, styles.sectionTitle, { color: colors.textTertiary }]}>{title}</Text>
      )}
      {rows.map((row, i) => (
        <React.Fragment key={i}>
          {i > 0 && <View style={[styles.separator, { backgroundColor: colors.borderLight }]} />}
          {row}
        </React.Fragment>
      ))}
      <View style={[styles.groupEnd, { backgroundColor: colors.borderLight }]} />
    </View>
  );
}

interface MenuRowProps {
  icon: string;
  label: string;
  subtitle?: string;
  /** Shows a green count pill when > 0. */
  count?: number;
  onPress: () => void;
}

export function MenuRow({ icon, label, subtitle, count, onPress }: MenuRowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}
      onPress={() => { haptics.select(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.iconCircle, { backgroundColor: colors.backgroundTertiary }]}>
        <Icon name={icon as any} size={18} color={colors.textPrimary} />
      </View>
      <View style={styles.rowText}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{label}</Text>
        {!!subtitle && (
          <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text>
        )}
      </View>
      {!!count && count > 0 && (
        <View style={[styles.count, { backgroundColor: colors.primaryDark }]}>
          <Text style={[typeScale.caption, styles.countText]}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
      <Icon name="chevron-right" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.xl,
  },
  groupEnd: { height: StyleSheet.hairlineWidth },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm - 1,
    paddingHorizontal: spacing.xl,
  },
  iconCircle: {
    width: ICON_CIRCLE,
    height: ICON_CIRCLE,
    borderRadius: ICON_CIRCLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  count: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: '#FFFFFF', fontWeight: '700' },
});
