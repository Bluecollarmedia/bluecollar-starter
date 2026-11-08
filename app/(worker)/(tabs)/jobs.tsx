import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { useWorkerContext } from '@/providers/WorkerProvider';
import { useMaintenance } from '@/hooks/useMaintenance';
import { db } from '@/data/store';
import { stopAddress, formatClock } from '@/components/maintenance/format';
import type { MaintenanceStopDetail } from '@/types/maintenance';
import { EmptyState } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import type { Assignment } from '@/types/schedule';
import { localDateKey } from '@/lib/ids';
import { getProjectImageUriById, getWorkerHeaderImageUri } from '@/lib/projectImages';
import { BrandCover } from '@/components/branding/BrandCover';
import { useT, tr } from '@/i18n';

function formatTime(time?: string) {
  if (!time) return '';
  const [h, m] = time.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

function formatDateHeading(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const y = new Date(today);
  y.setDate(y.getDate() - 1);

  const iso = (x: Date) => localDateKey(x);
  if (dateStr === iso(today)) return tr('Today');
  if (dateStr === iso(tomorrow)) return tr('Tomorrow');
  if (dateStr === iso(y)) return tr('Yesterday');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function groupByDate(assignments: Assignment[]) {
  const groups: { date: string; items: Assignment[] }[] = [];
  for (const a of assignments) {
    const last = groups[groups.length - 1];
    if (last && last.date === a.scheduledDate) {
      last.items.push(a);
    } else {
      groups.push({ date: a.scheduledDate, items: [a] });
    }
  }
  return groups;
}

/** A route stop this worker finished or skipped. Past work includes route stops, not only project jobs. */
function PastStopCard({ stop, onPress }: { stop: MaintenanceStopDetail; onPress: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const skipped = stop.status === 'skipped';
  const at = skipped ? stop.skippedAt : stop.completedAt;
  return (
    <Pressable style={[styles.jobCard, { backgroundColor: colors.surface }, shadow.sm]} onPress={onPress} accessibilityRole="button">
      <View style={styles.jobInfo}>
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]} numberOfLines={1}>{stop.property?.name ?? t('Property')}</Text>
        <View style={styles.metaRow}>
          <Feather name={skipped ? 'skip-forward' : 'check-circle'} size={12} color={colors.textTertiary} />
          <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: 4 }]}>
            {skipped ? t('Skipped') : at ? t('Finished {time}', { time: formatClock(at) }) : t('Finished')}
          </Text>
        </View>
        {stopAddress(stop) ? (
          <View style={styles.metaRow}>
            <Feather name="map-pin" size={12} color={colors.textTertiary} />
            <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: 4 }]} numberOfLines={1}>{stopAddress(stop)}</Text>
          </View>
        ) : null}
      </View>
      <Feather name="chevron-right" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

function JobCard({ assignment, onPress }: { assignment: Assignment; onPress: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <Pressable style={[styles.jobCard, { backgroundColor: colors.surface }, shadow.sm]} onPress={onPress}>
      <BrandCover uri={getProjectImageUriById(assignment.projectId)} style={styles.thumb} variant="tile" />
      <View style={styles.jobInfo}>
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]} numberOfLines={1}>
          {assignment.project?.name ?? t('Unknown Project')}
        </Text>
        <View style={styles.metaRow}>
          <Feather name="clock" size={12} color={colors.textTertiary} />
          <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: 4 }]}>
            {assignment.isFullDay ? t('Full day') : `${formatTime(assignment.startTime)} – ${formatTime(assignment.endTime)}`}
          </Text>
        </View>
        {assignment.project?.address && (
          <View style={styles.metaRow}>
            <Feather name="map-pin" size={12} color={colors.textTertiary} />
            <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: 4 }]} numberOfLines={1}>
              {assignment.project.address}
            </Text>
          </View>
        )}
        {assignment.truck && (
          <View style={styles.metaRow}>
            <Feather name="truck" size={12} color={colors.textTertiary} />
            <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: 4 }]}>
              {assignment.truck.name}
            </Text>
          </View>
        )}
      </View>
      <Feather name="chevron-right" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

export default function WorkerJobsScreen() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const router = useRouter();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const { upcomingAssignments, completedAssignments } = useWorkerContext();

  const maintenance = useMaintenance();

  // Past also lists the route stops this worker was on and finished or skipped (they are not project jobs, so they were missing here).
  const pastStops = tab === 'past'
    ? maintenance.routes
        .filter((r) => r.status !== 'cancelled' && (r.leadPersonId === db.personId || r.crewIds.includes(db.personId)))
        .flatMap((r) => r.stops.filter((s) => s.status === 'completed' || s.status === 'skipped').map((stop) => ({ date: r.serviceDate, stop })))
    : [];
  const jobGroups = groupByDate(tab === 'upcoming' ? upcomingAssignments : completedAssignments);
  const dates = [...new Set([...jobGroups.map((g) => g.date), ...pastStops.map((p) => p.date)])].sort((a, b) => (tab === 'past' ? b.localeCompare(a) : a.localeCompare(b)));
  const groups = dates.map((date) => ({
    date,
    items: jobGroups.find((g) => g.date === date)?.items ?? [],
    stops: pastStops.filter((p) => p.date === date).map((p) => p.stop),
  }));
  const data = groups;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.hero}>
        <BrandCover uri={getWorkerHeaderImageUri()} style={[styles.heroImage, { opacity: 0.16 }]} />
        <View style={[styles.headerContent, { paddingTop: insets.top + spacing.md }]}>
          <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>{t('My Jobs')}</Text>
          <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: 2 }]}>
            {t('Your upcoming and past assignments')}
          </Text>
        </View>
      </View>

      <View style={styles.segmentWrap}>
        <SegmentedControl
          values={[t('Upcoming'), t('Past')]}
          selectedIndex={tab === 'upcoming' ? 0 : 1}
          onChange={(event) => setTab(event.nativeEvent.selectedSegmentIndex === 0 ? 'upcoming' : 'past')}
          tintColor={colors.primary}
          appearance="light"
          backgroundColor={colors.groupedBackground}
          fontStyle={{ color: colors.textSecondary }}
          activeFontStyle={{ color: '#FFFFFF', fontWeight: '600' }}
          style={styles.segmentControl}
        />
      </View>

      {data.length === 0 ? (
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="clipboard"
            title={tab === 'upcoming' ? t('No upcoming jobs') : t('No past jobs yet')}
            description={t('Your assigned jobs will appear here.')}
          />
        </View>
      ) : (
        <ScrollView bounces={false} contentContainerStyle={[styles.listContent, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
          {groups.map(group => (
            <View key={group.date} style={styles.dateGroup}>
              <View style={styles.dateHeaderRow}>
                <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
                  {formatDateHeading(group.date)}
                </Text>
                <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>
                  {group.items.length + group.stops.length > 1 ? t('{n} jobs', { n: group.items.length + group.stops.length }) : t('{n} job', { n: group.items.length + group.stops.length })}
                </Text>
              </View>
              {group.items.map(a => (
                <JobCard key={a.id} assignment={a} onPress={() => router.push(`/(worker)/job/${a.id}` as any)} />
              ))}
              {group.stops.map((s) => (
                <PastStopCard key={s.id} stop={s} onPress={() => router.push(`/(worker)/maintenance-stop/${s.id}` as any)} />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: { overflow: 'hidden' },
  heroImage: { position: 'absolute', width: '100%', height: '100%' },
  headerContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  segmentWrap: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  segmentControl: {
    height: 36,
  },
  emptyContainer: { flex: 1, justifyContent: 'center' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing['4xl'] },
  dateGroup: { marginBottom: spacing.lg },
  dateHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  jobCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  thumb: { width: 56, height: 56, borderRadius: radius.md },
  jobInfo: { flex: 1, marginLeft: spacing.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
});
