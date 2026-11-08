import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { EmptyState } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { useWorkerActivitySummary, formatWorkedDuration, ACTIVITY_PERIODS, type ActivityPeriod, type DayGroup } from '@/hooks/useWorkerActivitySummary';
import { getWorkerHeaderImageUri } from '@/lib/projectImages';
import { BrandCover } from '@/components/branding/BrandCover';
import { useT, tr } from '@/i18n';
import { db } from '@/data/store';
import { useMaintenance } from '@/hooks/useMaintenance';
import MaintenanceActivityScreen from '../maintenance/activity';


function formatDayHeading(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  if (sameDay(date, today)) return tr('Today');
  if (sameDay(date, yesterday)) return tr('Yesterday');
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function DayCard({ day, onPress }: { day: DayGroup; onPress: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const isMultiJob = day.sessions.length > 1;

  return (
    <Pressable style={[styles.dayCard, { backgroundColor: colors.surface }, shadow.sm]} onPress={onPress}>
      <View style={styles.dayCardTop}>
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
          {formatDayHeading(day.date)}
        </Text>
        <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, fontWeight: '600' }]}>
          {formatWorkedDuration(day.totalWorkedMs)}
        </Text>
      </View>

      <View style={styles.dayCardBody}>
        {!isMultiJob && day.thumbnailUri && (
          <Image source={{ uri: day.thumbnailUri }} style={styles.thumb} resizeMode="cover" />
        )}
        <View style={{ flex: 1, marginLeft: !isMultiJob && day.thumbnailUri ? spacing.md : 0 }}>
          {isMultiJob ? (
            day.sessions.map(s => (
              <View key={s.assignmentId} style={styles.propertyRow}>
                <Feather name="home" size={12} color={colors.textTertiary} />
                <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, marginLeft: spacing.xs }]} numberOfLines={1}>
                  {s.projectName}
                </Text>
              </View>
            ))
          ) : (
            <>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>
                {day.sessions[0].projectName}
              </Text>
              {day.sessions[0].address && (
                <View style={styles.propertyRow}>
                  <Feather name="map-pin" size={12} color={colors.textTertiary} />
                  <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.xs }]} numberOfLines={1}>
                    {day.sessions[0].address}
                  </Text>
                </View>
              )}
            </>
          )}

          <View style={styles.statsRow}>
            <StatChip icon="briefcase" label={day.jobs > 1 ? t('{n} jobs', { n: day.jobs }) : t('{n} job', { n: day.jobs })} colors={colors} />
            <StatChip icon="check-square" label={day.tasksCompleted !== 1 ? t('{n} tasks', { n: day.tasksCompleted }) : t('{n} task', { n: day.tasksCompleted })} colors={colors} />
            {day.photosUploaded > 0 && (
              <StatChip icon="camera" label={day.photosUploaded > 1 ? t('{n} photos', { n: day.photosUploaded }) : t('{n} photo', { n: day.photosUploaded })} colors={colors} />
            )}
          </View>
        </View>
        <Feather name="chevron-right" size={18} color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

function StatChip({ icon, label, colors }: { icon: keyof typeof Feather.glyphMap; label: string; colors: any }) {
  return (
    <View style={styles.statChip}>
      <Feather name={icon} size={12} color={colors.textTertiary} />
      <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: 4 }]}>{label}</Text>
    </View>
  );
}

export default function WorkerActivityScreen() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const router = useRouter();
  const [period, setPeriod] = useState<ActivityPeriod>('this_week');
  const [pickerOpen, setPickerOpen] = useState(false);
  const summary = useWorkerActivitySummary(period);
  const maintenance = useMaintenance();
  // A worker whose work is route stops (not project jobs) has nothing in this list, so show their route history instead of an empty page.
  const hasRouteHistory = maintenance.routes.some((r) => r.status !== 'cancelled' && (r.leadPersonId === db.personId || r.crewIds.includes(db.personId)) && r.stops.some((x) => x.status === 'completed' || x.status === 'skipped'))
    || maintenance.events.some((e) => e.personId === db.personId);
  if (summary.days.length === 0 && hasRouteHistory) return <MaintenanceActivityScreen />;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.hero}>
        <BrandCover uri={getWorkerHeaderImageUri()} style={[styles.heroImage, { opacity: 0.16 }]} />
        <View style={[styles.headerContent, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>{t('Activity')}</Text>
              <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: 2 }]}>
                {t('Your work history and progress')}
              </Text>
            </View>
            <View>
              <Pressable
                style={[styles.periodChip, { backgroundColor: colors.groupedBackground }]}
                onPress={() => setPickerOpen(v => !v)}
              >
                <Text style={[typeScale.labelSmall, { color: colors.textPrimary, fontWeight: '600' }]}>
                  {t(summary.rangeLabel)}
                </Text>
                <Feather name="chevron-down" size={14} color={colors.textSecondary} style={{ marginLeft: 4 }} />
              </Pressable>
              {pickerOpen && (
                <View style={[styles.periodMenu, { backgroundColor: colors.surface }, shadow.md]}>
                  {ACTIVITY_PERIODS.map(p => (
                    <Pressable
                      key={p.key}
                      style={styles.periodMenuItem}
                      onPress={() => { setPeriod(p.key); setPickerOpen(false); }}
                    >
                      <Text style={[typeScale.bodyMedium, { color: period === p.key ? colors.primary : colors.textPrimary }]}>
                        {t(p.label)}
                      </Text>
                      {period === p.key && <Feather name="check" size={16} color={colors.primary} />}
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </View>
        </View>
      </View>

      <ScrollView bounces={false} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.summaryCard, { backgroundColor: colors.primarySurface }]}>
          <Text style={[typeScale.overline, { color: colors.primaryDark }]}>{t(summary.rangeLabel).toUpperCase()}</Text>
          <Text style={[typeScale.displayLarge, { color: colors.textPrimary, marginTop: 2 }]}>
            {formatWorkedDuration(summary.totalWorkedMs)}
          </Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{t('Total hours worked')}</Text>

          <View style={[styles.summaryDivider, { backgroundColor: colors.primary, opacity: 0.15 }]} />

          <View style={styles.summaryStatsRow}>
            <SummaryStat icon="briefcase" value={summary.jobs} label={t('Jobs')} colors={colors} />
            <SummaryStat icon="check-circle" value={summary.tasksCompleted} label={t('Tasks completed')} colors={colors} />
            <SummaryStat icon="camera" value={summary.photosUploaded} label={t('Photos uploaded')} colors={colors} />
          </View>
        </View>

        <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.md }]}>
          {t('Recent Activity')}
        </Text>

        {summary.days.length === 0 ? (
          <EmptyState
            icon="activity"
            title={period === 'all_time' ? t('No activity yet') : t('No activity {period}', { period: t(summary.rangeLabel).toLowerCase() })}
            description={t('Your check-ins, tasks, and photos will appear here.')}
          />
        ) : (
          summary.days.map(day => (
            <DayCard key={day.date} day={day} onPress={() => router.push(`/(worker)/day/${day.date}` as any)} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function SummaryStat({ icon, value, label, colors }: { icon: keyof typeof Feather.glyphMap; value: number; label: string; colors: any }) {
  return (
    <View style={styles.summaryStat}>
      <Feather name={icon} size={16} color={colors.primaryDark} />
      <Text style={[typeScale.headingLarge, { color: colors.textPrimary, marginTop: 4 }]}>{value}</Text>
      <Text style={[typeScale.caption, { color: colors.textSecondary, textAlign: 'center' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: { zIndex: 10 },
  heroImage: { position: 'absolute', width: '100%', height: '100%' },
  headerContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  periodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  periodMenu: {
    position: 'absolute',
    top: 40,
    right: 0,
    borderRadius: radius.lg,
    paddingVertical: spacing.xs,
    minWidth: 160,
    zIndex: 10,
  },
  periodMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing['4xl'] },
  summaryCard: {
    borderRadius: radius.xl,
    padding: spacing.lg,
  },
  summaryDivider: { height: 1, marginVertical: spacing.md },
  summaryStatsRow: { flexDirection: 'row' },
  summaryStat: { flex: 1, alignItems: 'center' },
  dayCard: {
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  dayCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  dayCardBody: { flexDirection: 'row', alignItems: 'center' },
  thumb: { width: 52, height: 52, borderRadius: radius.md },
  propertyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  statChip: { flexDirection: 'row', alignItems: 'center' },
});
