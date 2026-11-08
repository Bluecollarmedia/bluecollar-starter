import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { useT } from '@/i18n';
import { formatClock, servicesLabel, stopAddress } from './format';
import { ServiceIcon } from './ServiceIcon';
import { displayStatus, type StopDisplayStatus } from './types';
import type { MaintenanceStopDetail } from '@/types/maintenance';

const STATUS_LABEL: Record<StopDisplayStatus, string> = {
  upcoming: 'Upcoming',
  next: 'Up next',
  arrived: 'On site',
  completed: 'Done',
  skipped: 'Skipped',
};

export function StopStatusPill({ status, icon }: { status: StopDisplayStatus; icon?: boolean }) {
  const t = useT();
  const { colors } = useTheme();
  const tone =
    status === 'next' || status === 'arrived'
      ? { bg: colors.primarySurface, fg: colors.primaryDark }
      : status === 'completed'
        ? { bg: colors.successLight, fg: colors.success }
        : { bg: colors.backgroundTertiary, fg: colors.textSecondary };
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }, icon && styles.pillWithIcon]}>
      {icon && (status === 'next' || status === 'arrived') ? <Feather name="clock" size={14} color={tone.fg} /> : null}
      <Text style={[typeScale.labelSmall, { color: tone.fg }]}>{t(STATUS_LABEL[status])}</Text>
    </View>
  );
}

interface StopRowProps {
  stop: MaintenanceStopDetail;
  nextStopId?: string;
  /** Names for "Finished 10:42 AM by Tyler". */
  nameOf?: (personId?: string) => string | undefined;
  first?: boolean;
  /** Show the visit's instructions inline (Today shows them for the current stop only). */
  showInstructions?: boolean;
  /** A later stop that can't be started until the one before it is done. */
  locked?: boolean;
  onPress?: () => void;
}

/** One numbered stop in route order, as in the "Upcoming Stops" list. */
export function StopRow({ stop, nextStopId, nameOf, first, showInstructions, locked, onPress }: StopRowProps) {
  const t = useT();
  const { colors } = useTheme();
  const status = displayStatus(stop, nextStopId);
  const active = status === 'next' || status === 'arrived';
  const done = status === 'completed';
  const muted = done || status === 'skipped';
  const property = stop.property?.name ?? t('Property');
  const finishedBy = nameOf?.(stop.completedBy);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
        pressed && { backgroundColor: colors.surfacePressed },
        muted && { opacity: 0.6 },
      ]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={t('Stop {n}, {property}, {status}', { n: stop.number, property, status: t(STATUS_LABEL[status]) })}
    >
      <View
        style={[
          styles.number,
          { backgroundColor: active ? colors.primaryDark : done ? colors.primary : colors.border },
        ]}
      >
        {done ? (
          <Feather name="check" size={16} color="#FFFFFF" />
        ) : (
          <Text style={[typeScale.labelLarge, { color: active ? '#FFFFFF' : colors.textSecondary }]}>{stop.number}</Text>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text
            style={[typeScale.headingSmall, { color: muted ? colors.textSecondary : colors.textPrimary, flex: 1 }]}
            numberOfLines={2}
          >
            {property}
          </Text>
          {locked && status === 'upcoming' ? <Feather name="lock" size={14} color={colors.textTertiary} /> : null}
          <StopStatusPill status={status} />
        </View>
        <View style={styles.meta}>
          <Feather name="map-pin" size={13} color={colors.textTertiary} />
          <Text style={[typeScale.bodySmall, styles.metaText, { color: colors.textSecondary }]} numberOfLines={1}>
            {stopAddress(stop)}
          </Text>
        </View>
        <View style={styles.meta}>
          <ServiceIcon label={servicesLabel(stop)} size={15} color={colors.primary} />
          <Text style={[typeScale.bodySmall, styles.metaText, { color: colors.textSecondary }]} numberOfLines={2}>
            {servicesLabel(stop)}
          </Text>
        </View>
        {done && stop.completedAt && (
          <View style={styles.meta}>
            <Feather name="check-circle" size={13} color={colors.success} />
            <Text style={[typeScale.bodySmall, styles.metaText, { color: colors.textSecondary }]} numberOfLines={1}>
              {finishedBy ? t('Finished {time} by {name}', { time: formatClock(stop.completedAt), name: finishedBy }) : t('Finished {time}', { time: formatClock(stop.completedAt) })}
            </Text>
          </View>
        )}
        {showInstructions && stop.instructions ? (
          <View style={[styles.note, { backgroundColor: colors.primarySurface }]}>
            <Feather name="info" size={13} color={colors.primaryDark} />
            <Text style={[typeScale.bodySmall, styles.metaText, { color: colors.textPrimary }]}>{stop.instructions}</Text>
          </View>
        ) : null}
      </View>

      {onPress && <Feather name="chevron-right" size={18} color={colors.textTertiary} style={styles.chevron} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  number: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  body: { flex: 1, marginLeft: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  meta: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  metaText: { marginLeft: spacing.xs, flexShrink: 1 },
  note: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.sm },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full },
  pillWithIcon: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 6 },
  chevron: { marginLeft: spacing.xs, marginTop: 8 },
});
