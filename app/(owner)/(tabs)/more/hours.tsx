import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { Avatar } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { useWorkSessions, type WorkerWeeklyHours, type DailyHours } from '@/hooks/useOperations';
import { localDateKey } from '@/lib/ids';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getWeekLabel(start: string, end: string): string {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export default function HoursScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const { getAllWorkersWeeklyHours } = useWorkSessions();

  const [weekOffset, setWeekOffset] = useState(0);
  const [expandedWorker, setExpandedWorker] = useState<string | null>(null);

  const referenceDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + weekOffset * 7);
    return localDateKey(d);
  }, [weekOffset]);

  const weeklyData = useMemo(
    () => getAllWorkersWeeklyHours(referenceDate),
    [getAllWorkersWeeklyHours, referenceDate],
  );

  const weekRange = useMemo(() => {
    if (weeklyData.length > 0) return { start: weeklyData[0].weekStart, end: weeklyData[0].weekEnd };
    const d = new Date(referenceDate + 'T12:00:00Z');
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon = new Date(d);
    mon.setUTCDate(d.getUTCDate() + diff);
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    return { start: mon.toISOString().split('T')[0], end: sun.toISOString().split('T')[0] };
  }, [weeklyData, referenceDate]);

  const totalTeamHours = useMemo(
    () => weeklyData.reduce((sum, w) => sum + w.totalHours, 0),
    [weeklyData],
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm, borderBottomColor: colors.borderLight }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1, textAlign: 'center' }]}>
          Hours
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={[styles.weekNav, { borderBottomColor: colors.borderLight }]}>
        <Pressable onPress={() => setWeekOffset((w) => w - 1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Previous week">
          <Icon name="chevron-left" size={24} color={colors.primaryOnWhite} />
        </Pressable>
        <View style={styles.weekLabelWrap}>
          <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>
            {getWeekLabel(weekRange.start, weekRange.end)}
          </Text>
          {weekOffset === 0 && (
            <Text style={[typeScale.caption, { color: colors.primaryOnWhite }]}>This Week</Text>
          )}
        </View>
        <Pressable onPress={() => setWeekOffset((w) => w + 1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Next week">
          <Icon name="chevron-right" size={24} color={weekOffset >= 0 ? colors.textTertiary : colors.primaryOnWhite} />
        </Pressable>
      </View>

      <ScrollView bounces={false} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.summaryCard, { backgroundColor: colors.primarySurface }]}>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>TEAM TOTAL</Text>
          <Text style={[typeScale.displaySmall, { color: colors.primaryOnWhite }]}>
            {formatHours(totalTeamHours)}
          </Text>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
            {weeklyData.length} worker{weeklyData.length !== 1 ? 's' : ''}
          </Text>
        </View>

        {weeklyData.map((wh) => (
          <WorkerHoursCard
            key={wh.personId}
            data={wh}
            expanded={expandedWorker === wh.personId}
            onToggle={() =>
              setExpandedWorker((prev) => (prev === wh.personId ? null : wh.personId))
            }
            colors={colors}
          />
        ))}

        {weeklyData.length === 0 && (
          <View style={styles.empty}>
            <Icon name="clock" size={48} color={colors.textTertiary} />
            <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: spacing.md }]}>
              No hours recorded this week
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function WorkerHoursCard({
  data,
  expanded,
  onToggle,
  colors,
}: {
  data: WorkerWeeklyHours;
  expanded: boolean;
  onToggle: () => void;
  colors: any;
}) {
  const maxDayHours = Math.max(...data.dailyHours.map((d) => d.totalHours), 1);

  return (
    <View style={[styles.workerCard, { backgroundColor: colors.surface }, shadow.sm]}>
      <Pressable style={styles.workerHeader} onPress={onToggle}>
        <Avatar firstName={data.worker.firstName} lastName={data.worker.lastName} size={40} uri={data.worker.avatarUrl} />
        <View style={styles.workerInfo}>
          <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>
            {data.worker.firstName} {data.worker.lastName}
          </Text>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
            {data.dailyHours.filter((d) => d.totalMinutes > 0).length} days worked
          </Text>
        </View>
        <Text style={[typeScale.headingLarge, { color: colors.primaryOnWhite }]}>
          {formatHours(data.totalHours)}
        </Text>
        <Icon
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textTertiary}
          style={{ marginLeft: spacing.sm }}
        />
      </Pressable>

      {expanded && (
        <View style={[styles.dayBreakdown, { borderTopColor: colors.borderLight }]}>
          {data.dailyHours.map((day, i) => (
            <View key={day.date} style={styles.dayRow}>
              <Text style={[typeScale.caption, { color: colors.textSecondary, width: 36 }]}>
                {DAY_NAMES[i]}
              </Text>
              <View style={styles.barWrap}>
                <View
                  style={[
                    styles.bar,
                    {
                      backgroundColor: day.totalMinutes > 0 ? colors.primary : colors.borderLight,
                      width: day.totalMinutes > 0 ? `${Math.max((day.totalHours / maxDayHours) * 100, 8)}%` : '4%',
                    },
                  ]}
                />
              </View>
              <Text
                style={[
                  typeScale.caption,
                  {
                    color: day.totalMinutes > 0 ? colors.textPrimary : colors.textTertiary,
                    width: 50,
                    textAlign: 'right',
                  },
                ]}
              >
                {day.totalMinutes > 0 ? formatHours(day.totalHours) : '—'}
              </Text>
            </View>
          ))}

          {data.dailyHours.some((d) => d.sessions.length > 0) && (
            <View style={[styles.sessionsList, { borderTopColor: colors.borderLight }]}>
              <Text style={[typeScale.overline, { color: colors.textTertiary, marginBottom: spacing.sm }]}>
                SESSIONS
              </Text>
              {data.dailyHours
                .flatMap((d) => d.sessions)
                .map((s) => (
                  <View key={s.id} style={[styles.sessionRow, { borderBottomColor: colors.borderLight }]}>
                    <View style={styles.sessionInfo}>
                      <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
                        {s.project?.name}
                      </Text>
                      <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                        {new Date(s.checkInTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        {' · '}
                        {new Date(s.checkInTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        {s.checkOutTime && (
                          <> – {new Date(s.checkOutTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</>
                        )}
                      </Text>
                    </View>
                    <View style={styles.sessionMeta}>
                      <Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>
                        {s.durationMinutes ? formatHours(s.durationMinutes / 60) : 'Active'}
                      </Text>
                      {s.status === 'corrected' && (
                        <View style={[styles.correctedBadge, { backgroundColor: colors.warningLight }]}>
                          <Text style={[typeScale.caption, { color: colors.warning }]}>Corrected</Text>
                        </View>
                      )}
                    </View>
                  </View>
                ))}
            </View>
          )}
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
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  weekLabelWrap: { alignItems: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing['5xl'], gap: spacing.md },
  summaryCard: {
    alignItems: 'center',
    padding: spacing.xl,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  workerCard: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  workerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  workerInfo: { flex: 1 },
  dayBreakdown: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    gap: spacing.xs,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 24,
  },
  barWrap: { flex: 1, height: 12, borderRadius: 6, overflow: 'hidden' },
  bar: { height: 12, borderRadius: 6 },
  sessionsList: { borderTopWidth: 1, marginTop: spacing.md, paddingTop: spacing.md },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  sessionInfo: { flex: 1 },
  sessionMeta: { alignItems: 'flex-end', gap: spacing.xs },
  correctedBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing['2xs'],
    borderRadius: radius.xs,
  },
  empty: { alignItems: 'center', paddingVertical: spacing['4xl'] },
});
