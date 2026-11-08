import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useWorkers, WorkerWithStatus } from '@/hooks/useWorkers';
import { SearchBar, FilterChips, EmptyState, Avatar, StatusBadge, CrewLabels } from '@/components/ui';
import { useCrews } from '@/hooks/useCrews';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { w } from '@/config/brand';
import { fixed } from '@/theme/colors';

type FilterKey = 'all' | 'working_today' | 'needs_confirmation' | 'inactive';

function formatTime(time?: string): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function matchesFilter(w: WorkerWithStatus, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'inactive') return w.todayStatus === 'inactive';
  if (filter === 'needs_confirmation') return w.todayStatus === 'scheduled';
  return w.todayStatus === 'confirmed';
}

export default function WorkersListScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterKey>('all');
  const [crewFilter, setCrewFilter] = useState<string | null>(null);
  const { crews, crewsOf } = useCrews();

  // No statusFilter passed to the hook — it only supports the old
  // confirmed/scheduled/not_scheduled/inactive keys. We filter locally
  // below using the same underlying todayStatus, so schedule-confirmation
  // state and worker/account (inactive) status stay two separate concepts.
  const { workers: searched, allWorkers } = useWorkers({ search, includeInactive: true });

  const filterCounts = useMemo(() => {
    let workingToday = 0;
    let needsConfirmation = 0;
    let inactive = 0;
    for (const w of allWorkers) {
      if (w.todayStatus === 'confirmed') workingToday++;
      else if (w.todayStatus === 'scheduled') needsConfirmation++;
      else if (w.todayStatus === 'inactive') inactive++;
    }
    return { all: allWorkers.length, workingToday, needsConfirmation, inactive };
  }, [allWorkers]);

  const filterOptions: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: filterCounts.all },
    { key: 'working_today', label: 'Working Today', count: filterCounts.workingToday },
    { key: 'needs_confirmation', label: 'Needs Confirmation', count: filterCounts.needsConfirmation },
    { key: 'inactive', label: 'Inactive', count: filterCounts.inactive },
  ];

  const activeCrewFilter = crews.some(c => c.id === crewFilter) ? crewFilter : null;
  const displayedWorkers = searched.filter((w) =>
    matchesFilter(w, statusFilter) && (!activeCrewFilter || crewsOf(w.person.id).some(c => c.id === activeCrewFilter)));

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.titleRow}>
          <View>
            <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>Workers</Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
              {allWorkers.length} team member{allWorkers.length === 1 ? '' : 's'}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push('/(owner)/resources' as any)}
              style={({ pressed }) => [styles.resourcesPill, { backgroundColor: pressed ? colors.border : colors.primarySurface }]}
              accessibilityRole="button"
              accessibilityLabel="Resources and access"
            >
              <Icon name="key" size={14} color={colors.primaryDark} />
              <Text style={[typeScale.labelSmall, { color: colors.primaryDark, marginLeft: 6 }]}>Resources & Access</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/(owner)/worker-new')}
              style={[styles.addButton, { backgroundColor: colors.primary }]}
              accessibilityLabel="Add worker"
            >
              <Icon name="plus" size={22} color={colors.textOnPrimary} />
            </Pressable>
          </View>
        </View>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search workers..."
          style={styles.searchBar}
        />
        <FilterChips
          options={filterOptions}
          selected={statusFilter}
          onSelect={setStatusFilter}
        />
        {/* Crews: tap one to show only its workers */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crewStrip}>
          {crews.map(c => {
            const selected = activeCrewFilter === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setCrewFilter(selected ? null : c.id)}
                style={({ pressed }) => [
                  styles.crewChip,
                  { backgroundColor: selected ? c.color : `${c.color}1F` },
                  pressed && { transform: [{ scale: 0.96 }] },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${c.name}, ${c.memberIds.length} workers`}
              >
                <View style={[styles.crewDot, { backgroundColor: selected ? fixed.white : c.color }]} />
                <Text style={[typeScale.labelSmall, { color: selected ? fixed.white : c.color, fontWeight: '700' }]} numberOfLines={1}>
                  {c.name} · {c.memberIds.length}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => router.push('/(owner)/crews' as any)}
            style={({ pressed }) => [styles.crewChip, { backgroundColor: pressed ? colors.border : colors.backgroundTertiary }]}
            accessibilityRole="button"
            accessibilityLabel={crews.length ? w('Manage crews') : w('Make a crew')}
          >
            <Icon name={crews.length ? 'edit-2' : 'plus'} size={13} color={colors.textPrimary} />
            <Text style={[typeScale.labelSmall, { color: colors.textPrimary, fontWeight: '700' }]}>
              {crews.length ? w('Crews') : w('Make a Crew')}
            </Text>
          </Pressable>
        </ScrollView>
      </View>

      {displayedWorkers.length === 0 ? (
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="users"
            title={search ? 'No matching workers' : 'No workers here'}
            description={search ? 'Try a different search.' : 'No workers match this filter.'}
          />
        </View>
      ) : (
        <FlatList bounces={false}
          data={displayedWorkers}
          keyExtractor={(item) => item.person.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: tabBarClearance }]}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isInactive = item.todayStatus === 'inactive';
            const workerCrews = crewsOf(item.person.id);
            const assignment = item.todayAssignments[0];
            const badge = isInactive
              ? { label: 'Inactive', status: 'error' as const }
              : item.todayStatus === 'confirmed'
              ? { label: 'Confirmed', status: 'success' as const }
              : item.todayStatus === 'scheduled'
              ? { label: 'Scheduled', status: 'warning' as const }
              : { label: 'Not Scheduled', status: 'neutral' as const };

            return (
              <Pressable
                style={({ pressed }) => [
                  styles.workerCard,
                  { backgroundColor: colors.surface },
                  shadow.sm,
                  pressed && { opacity: 0.92 },
                ]}
                onPress={() => router.push(`/(owner)/workers/${item.person.id}` as any)}
              >
                <Avatar firstName={item.person.firstName} lastName={item.person.lastName} size={48} uri={item.person.avatarUrl} />
                <View style={styles.workerInfo}>
                  <View style={styles.workerNameRow}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', flexShrink: 1, marginRight: spacing.sm }]} numberOfLines={1}>
                      {item.person.firstName} {item.person.lastName}
                    </Text>
                    <StatusBadge label={badge.label} status={badge.status} />
                  </View>
                  <CrewLabels crews={workerCrews} style={{ marginTop: 4 }} />

                  {isInactive ? (
                    <>
                      <Text style={[typeScale.bodySmall, { color: colors.textTertiary, marginTop: 4 }]}>No scheduled work</Text>
                      {item.person.phone && (
                        <View style={styles.detailRow}>
                          <Icon name="phone" size={12} color={colors.textTertiary} />
                          <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
                            {item.person.phone}
                          </Text>
                        </View>
                      )}
                    </>
                  ) : assignment ? (
                    <>
                      <View style={styles.detailRow}>
                        <Icon name="map-pin" size={12} color={colors.textTertiary} />
                        <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.xs }]} numberOfLines={1}>
                          {assignment.project?.name ?? item.todayProject ?? w('Unknown job')}
                        </Text>
                      </View>
                      {(assignment.startTime || assignment.endTime) && (
                        <View style={styles.detailRow}>
                          <Icon name="clock" size={12} color={colors.textTertiary} />
                          <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
                            {formatTime(assignment.startTime)} – {formatTime(assignment.endTime)}
                          </Text>
                        </View>
                      )}
                      <View style={styles.detailRow}>
                        <Icon name="truck" size={12} color={colors.textTertiary} />
                        <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
                          {item.todayTruck ?? 'No truck assigned'}
                        </Text>
                      </View>
                    </>
                  ) : (
                    <Text style={[typeScale.bodySmall, { color: colors.textTertiary, marginTop: 4 }]}>Not scheduled today</Text>
                  )}
                </View>
                <Icon name="chevron-right" size={18} color={colors.textTertiary} />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: { marginBottom: spacing.sm },
  crewStrip: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  crewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
  crewDot: { width: 8, height: 8, borderRadius: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  resourcesPill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing['3xl'], paddingTop: spacing.xs },
  emptyContainer: { flex: 1, justifyContent: 'center' },
  workerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  workerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  workerInfo: { flex: 1 },
});
