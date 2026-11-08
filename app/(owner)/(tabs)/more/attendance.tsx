import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { Avatar, EmptyState } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic, tones, neutral } from '@/theme/colors';
import { useAttendance } from '@/hooks/useOperations';
import type { AttendanceStatus, WorkerAttendance } from '@/types/operations';
import { todayKey, localDateKey } from '@/lib/ids';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  const today = todayKey();
  const yesterday = (() => { const y = new Date(); y.setDate(y.getDate() - 1); return localDateKey(y); })();
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

const STATUS_CONFIG: Record<AttendanceStatus, { label: string; icon: string; color: string }> = {
  checked_in: { label: 'Checked In', icon: 'check-circle', color: semantic.success },
  checked_out: { label: 'Checked Out', icon: 'log-out', color: tones.neutral.fg },
  late: { label: 'Late', icon: 'alert-circle', color: semantic.warning },
  not_checked_in: { label: 'Not Checked In', icon: 'x-circle', color: semantic.error },
  past_scheduled_end: { label: 'Past End', icon: 'clock', color: semantic.warning },
  off_today: { label: 'Off', icon: 'moon', color: neutral.gray500 },
};

export default function AttendanceScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const { getAttendanceForDate, settings } = useAttendance();

  const [dayOffset, setDayOffset] = useState(0);
  const [expandedWorker, setExpandedWorker] = useState<string | null>(null);

  const currentDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    return localDateKey(d);
  }, [dayOffset]);

  const attendance = useMemo(
    () => getAttendanceForDate(currentDate),
    [getAttendanceForDate, currentDate],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { checked_in: 0, late: 0, not_checked_in: 0, checked_out: 0, past_scheduled_end: 0 };
    for (const w of attendance) {
      for (const a of w.assignments) {
        counts[a.status] = (counts[a.status] || 0) + 1;
      }
    }
    return counts;
  }, [attendance]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm, borderBottomColor: colors.borderLight }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1, textAlign: 'center' }]}>
          Attendance
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={[styles.dayNav, { borderBottomColor: colors.borderLight }]}>
        <Pressable onPress={() => setDayOffset((d) => d - 1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Previous day">
          <Icon name="chevron-left" size={24} color={colors.primary} />
        </Pressable>
        <Pressable onPress={() => setDayOffset(0)}>
          <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>
            {formatDateLabel(currentDate)}
          </Text>
        </Pressable>
        <Pressable onPress={() => setDayOffset((d) => d + 1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Next day">
          <Icon name="chevron-right" size={24} color={dayOffset >= 0 ? colors.textTertiary : colors.primary} />
        </Pressable>
      </View>

      <ScrollView bounces={false} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
        <View style={styles.statusChips}>
          {statusCounts.checked_in > 0 && (
            <View style={[styles.chip, { backgroundColor: semantic.successLight }]}>
              <View style={[styles.dot, { backgroundColor: semantic.success }]} />
              <Text style={[typeScale.caption, { color: semantic.success }]}>
                {statusCounts.checked_in} checked in
              </Text>
            </View>
          )}
          {statusCounts.late > 0 && (
            <View style={[styles.chip, { backgroundColor: semantic.warningLight }]}>
              <View style={[styles.dot, { backgroundColor: semantic.warning }]} />
              <Text style={[typeScale.caption, { color: semantic.warning }]}>
                {statusCounts.late} late
              </Text>
            </View>
          )}
          {statusCounts.not_checked_in > 0 && (
            <View style={[styles.chip, { backgroundColor: semantic.errorLight }]}>
              <View style={[styles.dot, { backgroundColor: semantic.error }]} />
              <Text style={[typeScale.caption, { color: semantic.error }]}>
                {statusCounts.not_checked_in} missing
              </Text>
            </View>
          )}
          {statusCounts.past_scheduled_end > 0 && (
            <View style={[styles.chip, { backgroundColor: semantic.warningLight }]}>
              <View style={[styles.dot, { backgroundColor: semantic.warning }]} />
              <Text style={[typeScale.caption, { color: semantic.warning }]}>
                {statusCounts.past_scheduled_end} past end
              </Text>
            </View>
          )}
          {statusCounts.checked_out > 0 && (
            <View style={[styles.chip, { backgroundColor: colors.backgroundTertiary }]}>
              <View style={[styles.dot, { backgroundColor: colors.textTertiary }]} />
              <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                {statusCounts.checked_out} done
              </Text>
            </View>
          )}
        </View>

        {attendance.map((wa) => (
          <AttendanceCard
            key={wa.personId}
            data={wa}
            expanded={expandedWorker === wa.personId}
            onToggle={() =>
              setExpandedWorker((prev) => (prev === wa.personId ? null : wa.personId))
            }
            settings={settings}
            colors={colors}
          />
        ))}

        {attendance.length === 0 && (
          <EmptyState icon="users" title="No workers scheduled" description="No one is scheduled to work on this day." />
        )}
      </ScrollView>
    </View>
  );
}

function AttendanceCard({
  data,
  expanded,
  onToggle,
  settings,
  colors,
}: {
  data: WorkerAttendance;
  expanded: boolean;
  onToggle: () => void;
  settings: any;
  colors: any;
}) {
  const worstStatus = data.assignments.reduce<AttendanceStatus>((worst, a) => {
    const priority: AttendanceStatus[] = ['not_checked_in', 'late', 'past_scheduled_end', 'checked_in', 'checked_out', 'off_today'];
    return priority.indexOf(a.status) < priority.indexOf(worst) ? a.status : worst;
  }, 'off_today');

  const config = STATUS_CONFIG[worstStatus];

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
      <Pressable style={styles.cardHeader} onPress={onToggle}>
        <Avatar
          firstName={data.worker?.firstName ?? '?'}
          lastName={data.worker?.lastName ?? '?'}
          size={40}
          uri={data.worker?.avatarUrl}
        />
        <View style={styles.cardInfo}>
          <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>
            {data.worker?.firstName} {data.worker?.lastName}
          </Text>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
            {data.assignments.length} assignment{data.assignments.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: config.color + '18' }]}>
          <Icon name={config.icon as any} size={14} color={config.color} />
          <Text style={[typeScale.caption, { color: config.color }]}>{config.label}</Text>
        </View>
        <Icon
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textTertiary}
          style={{ marginLeft: spacing.xs }}
        />
      </Pressable>

      {expanded && (
        <View style={[styles.cardBody, { borderTopColor: colors.borderLight }]}>
          {data.assignments.map((a) => {
            const aConfig = STATUS_CONFIG[a.status];
            return (
              <View key={a.assignmentId} style={[styles.assignmentRow, { borderBottomColor: colors.borderLight }]}>
                <Icon name={aConfig.icon as any} size={16} color={aConfig.color} />
                <View style={styles.assignmentInfo}>
                  <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>{a.projectName}</Text>
                  <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                    Scheduled: {a.scheduledStart ?? 'Full day'}
                    {a.scheduledEnd ? ` – ${a.scheduledEnd}` : ''}
                  </Text>
                  {a.actualCheckIn && (
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                      Checked in: {formatTime(a.actualCheckIn)}
                      {a.lateMinutes && a.lateMinutes > 0
                        ? <Text style={{ color: semantic.warning }}> ({a.lateMinutes}min late)</Text>
                        : null}
                    </Text>
                  )}
                  {a.actualCheckOut && (
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                      Checked out: {formatTime(a.actualCheckOut)}
                    </Text>
                  )}
                  {a.distanceFromSite !== undefined && (
                    <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                      GPS: {a.distanceFromSite}m from site
                      {a.withinRadius === false && (
                        <Text style={{ color: semantic.error }}> (outside radius)</Text>
                      )}
                    </Text>
                  )}
                </View>
              </View>
            );
          })}

          <View style={[styles.settingsNote, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
              Late threshold: {settings.lateCheckinThresholdMinutes}min · Grace period: {settings.missingCheckinGraceMinutes}min
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
  },
  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  content: { padding: spacing.lg, paddingBottom: spacing['5xl'], gap: spacing.md },
  statusChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  card: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardInfo: { flex: 1 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  cardBody: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1 },
  assignmentRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    alignItems: 'flex-start',
  },
  assignmentInfo: { flex: 1, gap: spacing['2xs'] },
  settingsNote: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.xs,
  },
  empty: { alignItems: 'center', paddingVertical: spacing['4xl'] },
});
