/**
 * One maintenance service's standing: name, timing ("Overdue by 5 days"),
 * last done, and the season count when there is one. Used on the owner's
 * property list and property detail.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBadge } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { DUE_BADGE, DUE_TONE, dueText, frequencyLabel, seasonCountText, shortDate } from '@/lib/maintenanceSchedule';
import type { ServiceDueInfo } from '@/types/maintenance';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

/** `compact` drops the last-done line; `showRule` adds how often it happens. */
export function ServiceDueLine({ info, onDate, compact, showRule }: { info: ServiceDueInfo; onDate: string; compact?: boolean; showRule?: boolean }) {
  const { colors } = useTheme();
  const count = seasonCountText(info);
  const warn = info.status === 'overdue';
  const meta = [
    info.lastServiceDate ? `Last done ${shortDate(info.lastServiceDate)}` : 'Never done',
    info.scheduledOn ? `On the ${shortDate(info.scheduledOn)} route` : undefined,
  ].filter(Boolean).join(' · ');

  return (
    <View style={styles.row}>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>
          {info.rule.label}
        </Text>
        {showRule && (
          <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>{frequencyLabel(info.rule)}</Text>
        )}
        <Text style={[typeScale.bodySmall, { color: warn ? colors.error : colors.textSecondary }]} numberOfLines={1}>
          {dueText(info, onDate)}
        </Text>
        {!compact && (
          <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>{meta}</Text>
        )}
        {!!count && (
          <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{count}</Text>
        )}
      </View>
      <StatusBadge label={DUE_BADGE[info.status]} status={DUE_TONE[info.status]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
