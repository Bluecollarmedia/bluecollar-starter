import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { formatAddress } from '@/lib/address';
import { useT } from '@/i18n';
import { yardLocationLabel } from '@/lib/maintenanceCheckIn';
import type { YardLocation } from '@/hooks/useCompanyYard';
import type { DayStartState } from '@/hooks/useMaintenanceCheckIn';

interface YardStartCardProps {
  dayStart: DayStartState;
  yard: YardLocation | null;
  yardName: string;
  /** Opens directions to the yard in the worker's map app. */
  onYardPress?: () => void;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/**
 * The worker's start-of-day state at the yard. Before Start Day it shows the
 * yard and a short note; after, a compact "Day started" line with the honest
 * location result. The Start Day button itself lives in the screen's fixed
 * bottom action area.
 */
export function YardStartCard({ dayStart, yard, yardName, onYardPress }: YardStartCardProps) {
  const t = useT();
  const { colors } = useTheme();

  if (dayStart.started && dayStart.startedAt) {
    const verified = dayStart.verified;
    return (
      <View
        style={[styles.startedRow, { backgroundColor: colors.backgroundSecondary }]}
        accessibilityRole="text"
        accessibilityLabel={`${t('Day started at {time}', { time: clock(dayStart.startedAt) })}. ${yardLocationLabel(dayStart.locationStatus)}.`}
      >
        <Feather name="check-circle" size={16} color={colors.primaryDark} />
        <Text style={[typeScale.labelLarge, styles.startedText, { color: colors.textPrimary }]} numberOfLines={1}>
          {t('Day started {time}', { time: clock(dayStart.startedAt) })}
        </Text>
        <View style={[styles.chip, { backgroundColor: verified ? colors.primarySurface : colors.warningLight }]}>
          <Feather name={verified ? 'map-pin' : 'alert-circle'} size={12} color={verified ? colors.primaryDark : colors.textSecondary} />
          <Text style={[typeScale.labelSmall, { color: verified ? colors.primaryDark : colors.textSecondary }]} numberOfLines={1}>
            {dayStart.corrected ? t('Set by office') : yardLocationLabel(dayStart.locationStatus)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[typeScale.overline, { color: colors.textSecondary }]}>{t('START OF DAY')}</Text>
      <Pressable
        onPress={yard ? onYardPress : undefined}
        disabled={!yard || !onYardPress}
        style={({ pressed }) => [styles.yardRow, pressed && { opacity: 0.7 }]}
        accessibilityRole={yard && onYardPress ? 'button' : 'text'}
        accessibilityLabel={yard ? `${yardName}, ${formatAddress(yard)}` : t('Yard address not set')}
        accessibilityHint={yard && onYardPress ? t('Opens directions to the yard') : undefined}
      >
        <View style={[styles.pin, { backgroundColor: colors.primary }]}>
          <Feather name="home" size={14} color={colors.textOnPrimary} />
        </View>
        <View style={styles.yardText}>
          <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]} numberOfLines={1}>{yardName}</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={2}>
            {yard ? formatAddress(yard) : t('The office hasn’t set the yard address yet.')}
          </Text>
        </View>
        {yard && onYardPress && <Feather name="navigation" size={16} color={colors.primaryDark} />}
      </Pressable>
      <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
        {t('Tap Start Day when you get to the yard. If you’re already at a property, go ahead and check in there. The office will see that the day wasn’t started.')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.sm },
  yardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  pin: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  yardText: { flex: 1, minWidth: 0 },
  startedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  startedText: { flexShrink: 0 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full, marginLeft: 'auto', flexShrink: 1 },
});
