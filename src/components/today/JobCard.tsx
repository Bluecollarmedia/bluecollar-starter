import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { useT } from '@/i18n';
import type { Assignment } from '@/types/schedule';
import type { StopCardState } from '@/components/today/StopCard';

const clock = (hhmm?: string) => {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h)) return hhmm;
  return `${h % 12 || 12}:${String(m ?? 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

/**
 * A landscaping job on the combined Today. Same three looks as a route stop (finished row, quiet row, big next card). Tapping opens the
 * job's own screen, where the check-in and the job's work already live; nothing about a job's rules changes here. The big OPEN JOB button
 * is the pinned bar at the bottom of the screen, like I'M HERE for a stop.
 */
export function JobCard({ job, state, onOpen }: { job: Assignment; state: StopCardState; onOpen: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const name = job.project?.name ?? t('Job');
  const address = job.project?.address ?? '';
  const when = job.isFullDay || !job.startTime ? t('Full day') : `${clock(job.startTime)}${job.endTime ? ` – ${clock(job.endTime)}` : ''}`;

  if (state === 'done') {
    return (
      <Pressable onPress={onOpen} accessibilityRole="button" style={[styles.row, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={[styles.check, { backgroundColor: colors.success }]}><Feather name="check" size={14} color="#FFFFFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]} numberOfLines={1}>{name}</Text>
          <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>{when}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.textTertiary} />
      </Pressable>
    );
  }
  if (state === 'later') {
    return (
      <Pressable onPress={onOpen} accessibilityRole="button" style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}>
        <View style={[styles.icon, { backgroundColor: colors.backgroundTertiary }]}><Feather name="briefcase" size={14} color={colors.textSecondary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]} numberOfLines={1}>{name}</Text>
          {address ? <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{address}</Text> : null}
          <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>{when}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.textTertiary} />
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={name} style={[styles.card, { backgroundColor: colors.surface }, shadow.md]}>
      <View style={styles.titleRow}>
        <View style={[styles.iconBig, { backgroundColor: colors.primaryDark }]}><Feather name="briefcase" size={18} color="#FFFFFF" /></View>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1 }]} numberOfLines={2}>{name}</Text>
      </View>
      {address ? (
        <View style={styles.meta}>
          <Feather name="map-pin" size={15} color={colors.textSecondary} />
          <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, flex: 1 }]} numberOfLines={2}>{address}</Text>
        </View>
      ) : null}
      <View style={styles.meta}>
        <Feather name="clock" size={15} color={colors.textSecondary} />
        <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, flex: 1 }]}>{when}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconBig: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  icon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  check: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
