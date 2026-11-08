import { useTeamAccess } from '@/hooks/useTeamAccess';
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useWorkers } from '@/hooks/useWorkers';
import { useSchedule } from '@/hooks/useSchedule';
import { useResources } from '@/hooks/useResources';
import { StatusBadge, Avatar, EmptyState, CrewLabels } from '@/components/ui';
import { useCrews } from '@/hooks/useCrews';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import { haptics } from '@/lib/haptics';
import { deleteUnusedMember } from '@/data/deleteMember';
import { todayKey, localDateKey } from '@/lib/ids';
import { loadBirthdays } from '@/data/birthday';
import { OwnerWorkerExtras } from '@/components/account/WorkerExtras';
import { OwnerClockCard } from '@/components/time/OwnerClockCard';
import { isFeatureOn, w as settingsWords } from '@/config/brand';

const TRUCKS_ON = isFeatureOn('trucks');
import { formatBirthday, birthdaySoon } from '@/lib/birthday';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { confirmAction, showMessage } from '@/components/financials/ActionSheet';

const today = todayKey();

function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

function formatTime(time?: string): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatHeaderDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatHiredDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const confirmLabel = (state: string) => {
  if (state === 'confirmed') return { label: 'Confirmed', status: 'success' as const };
  if (state === 'awaiting') return { label: 'Awaiting', status: 'warning' as const };
  if (state === 'updated_since') return { label: 'Updated', status: 'info' as const };
  return { label: 'Not Sent', status: 'neutral' as const };
};

export default function WorkerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const { getWorker, updateWorker } = useWorkers({ includeInactive: true });
  const team = useTeamAccess();
  const schedule = useSchedule();
  const { resourcesFor } = useResources();
  const { crews, crewsOf, setWorkerInCrew } = useCrews();

  const worker = getWorker(id);

  const [birthday, setBirthday] = useState<string | null>(null);
  const personId = worker?.person.id;
  useEffect(() => {
    if (!personId) return;
    let live = true;
    loadBirthdays([personId]).then((m) => { if (live) setBirthday(m[personId] ?? null); });
    return () => { live = false; };
  }, [personId]);

  if (!worker) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
            <Icon name="arrow-left" size={24} color={colors.textPrimary} />
          </Pressable>
        </View>
        <View style={styles.center}>
          <EmptyState icon="alert-circle" title="Worker not found" description="This worker may have been removed." />
        </View>
      </View>
    );
  }

  const w = worker;
  const p = w.person;
  const isActive = w.member.status === 'active';

  const workerCrews = crewsOf(p.id);

  const todayAssignments = schedule.getByWorker(p.id, today);
  const tomorrowAssignments = schedule.getByWorker(p.id, offsetDate(1));

  function handleCall() {
    if (!p.phone) return;
    Linking.openURL(`tel:${p.phone.replace(/[^\d+]/g, '')}`);
  }

  function handleEmail() {
    Linking.openURL(`mailto:${p.email}`);
  }

  function handleDeactivate() {
    const doDeactivate = () => {
      haptics.destructive();
      updateWorker(p.id, { status: 'inactive' });
      router.back();
    };
    confirmAction(
      'Deactivate Worker',
      `${p.firstName} ${p.lastName} will lose access. Historical records (hours, payroll, attendance) will be preserved.`,
      'Deactivate',
      doDeactivate,
      true,
    );
  }

  /** Brings a deactivated worker back. Old admin rights are never restored. */
  function handleReactivate() {
    confirmAction(
      `Reactivate ${p.firstName} ${p.lastName}?`,
      'They get access again. Nothing is assigned to them automatically, and their history stays as it is.',
      'Reactivate',
      async () => {
        const why = await team.reactivate(p.id);
        if (why) showMessage("Couldn't reactivate", why);
        else haptics.success();
      },
    );
  }

  /** Deletes a worker with no login and no records. Anyone else can only be deactivated, which keeps their history and payroll. */
  function handleDelete() {
    confirmAction(
      `Delete ${p.firstName} ${p.lastName}?`,
      settingsWords('This removes them completely and cannot be undone. It only works for a worker who never logged in and has no hours, jobs or other records.'),
      'Delete',
      async () => {
        const res = await deleteUnusedMember(p.id);
        if (res.ok) { haptics.destructive(); router.back(); return; }
        if (res.hasHistory && isActive) {
          confirmAction("Can't delete", res.error, 'Deactivate instead', handleDeactivate);
        } else {
          showMessage(res.hasHistory ? "Can't delete" : "Couldn't delete", res.error);
        }
      },
      true,
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1 }]}>
          Worker Profile
        </Text>
      </View>

      <ScrollView bounces={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Profile header */}
          <View style={[styles.profileCard, { backgroundColor: colors.surface }, shadow.sm]}>
            <View style={styles.profileTopRow}>
              <Avatar firstName={p.firstName} lastName={p.lastName} size={72} uri={p.avatarUrl} />
              <View style={{ marginLeft: spacing.md, flex: 1 }}>
                <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>
                  {p.firstName} {p.lastName}
                </Text>
                <View style={styles.badgeRow}>
                  <StatusBadge label={isActive ? 'Active' : 'Inactive'} status={isActive ? 'success' : 'error'} />
                  <CrewLabels crews={workerCrews} />
                </View>
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                  Worker · Hired {formatHiredDate(w.member.createdAt)}
                </Text>
              </View>
            </View>

            <View style={styles.contactRow}>
              <Pressable
                style={[styles.contactBtn, { backgroundColor: colors.primarySurface }, !p.phone && { opacity: 0.4 }]}
                onPress={handleCall}
                disabled={!p.phone}
              >
                <Icon name="phone" size={16} color={semantic.success} />
                <View style={{ marginLeft: spacing.sm }}>
                  <Text style={[typeScale.labelSmall, { color: colors.textPrimary, fontWeight: '700' }]}>Call</Text>
                  <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{p.phone ?? '—'}</Text>
                </View>
              </Pressable>
              <Pressable
                style={[styles.contactBtn, { backgroundColor: colors.backgroundTertiary }]}
                onPress={handleEmail}
              >
                <Icon name="mail" size={16} color={colors.textSecondary} />
                <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                  <Text style={[typeScale.labelSmall, { color: colors.textPrimary, fontWeight: '700' }]}>Email</Text>
                  <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{p.email}</Text>
                </View>
              </Pressable>
            </View>
            {birthday ? (
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.sm }]}>
                Birthday: {formatBirthday(birthday)}{birthdaySoon(birthday) ? ` · ${birthdaySoon(birthday)}` : ''}
              </Text>
            ) : null}
            {personId ? <OwnerWorkerExtras personId={personId} /> : null}
          </View>

          {/* Crew */}
          <View style={[styles.sectionCard, { backgroundColor: colors.surface }, shadow.sm]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '700' }]}>{settingsWords('Crew')}</Text>
              <Pressable onPress={() => router.push('/(owner)/crews' as any)} hitSlop={8} accessibilityRole="button">
                <Text style={[typeScale.bodySmall, { color: colors.primaryOnWhite, fontWeight: '600' }]}>{settingsWords('Manage Crews')}</Text>
              </Pressable>
            </View>
            <View style={styles.crewChoices}>
              {crews.map(c => {
                const selected = workerCrews.some(wc => wc.id === c.id);
                return (
                  <Pressable
                    key={c.id ?? 'none'}
                    onPress={() => { haptics.select(); setWorkerInCrew(p.id, c.id, !selected); }}
                    style={({ pressed }) => [
                      styles.crewChoice,
                      { borderColor: selected ? c.color : colors.border, backgroundColor: selected ? `${c.color}1F` : 'transparent' },
                      pressed && { opacity: 0.7 },
                    ]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                  >
                    <View style={[styles.crewDot, { backgroundColor: c.color }]} />
                    <Text style={[typeScale.bodySmall, { color: selected ? c.color : colors.textSecondary, fontWeight: selected ? '700' : '500' }]}>
                      {c.name}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => router.push('/(owner)/crew-edit' as any)}
                style={[styles.crewChoice, { borderColor: colors.border, borderStyle: 'dashed' }]}
                accessibilityRole="button"
              >
                <Icon name="plus" size={13} color={colors.textSecondary} />
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{settingsWords('New Crew')}</Text>
              </Pressable>
            </View>
          </View>

          {/* Today */}
          <View style={[styles.sectionCard, { backgroundColor: colors.surface }, shadow.sm]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '700' }]}>Today</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{formatHeaderDate(today)}</Text>
            </View>

            {todayAssignments.length > 0 ? (
              todayAssignments.map((a) => {
                const timeStr = a.isFullDay ? 'Full Day' : `${formatTime(a.startTime)} – ${formatTime(a.endTime)}`;
                const badge = confirmLabel(a.confirmationState);
                return (
                  <View key={a.id} style={[styles.assignmentBlock, { backgroundColor: colors.primarySurface }]}>
                    <View style={styles.assignmentTopRow}>
                      <View style={styles.assignmentDetailRow}>
                        <Icon name="map-pin" size={14} color={colors.textSecondary} />
                        <View style={{ marginLeft: spacing.xs }}>
                          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{a.project?.name}</Text>
                          {a.project?.address && (
                            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{a.project.address}</Text>
                          )}
                        </View>
                      </View>
                      <StatusBadge label={badge.label} status={badge.status} />
                    </View>
                    <View style={styles.assignmentDetailRow}>
                      <Icon name="clock" size={14} color={colors.textSecondary} />
                      <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>{timeStr}</Text>
                    </View>
                    {TRUCKS_ON && (
                      <View style={styles.assignmentDetailRow}>
                        <Icon name="truck" size={14} color={colors.textSecondary} />
                        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
                          {a.truck?.name ?? 'No truck assigned'}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })
            ) : (
              <Text style={[typeScale.bodySmall, { color: colors.textTertiary, marginTop: spacing.xs }]}>
                Not scheduled today
              </Text>
            )}

            {isActive ? (
              <Pressable
                style={[styles.scheduleWorkBtn, { backgroundColor: colors.primary }]}
                onPress={() => router.push(`/(owner)/schedule-create?workerId=${p.id}&date=${today}` as any)}
              >
                <Icon name="calendar" size={16} color={colors.textOnPrimary} />
                <Text style={[typeScale.labelLarge, { color: colors.textOnPrimary, fontWeight: '700', marginLeft: spacing.xs }]}>
                  Schedule Work
                </Text>
              </Pressable>
            ) : null}
          </View>

          {isActive && isFeatureOn('timeClock') ? <OwnerClockCard personId={p.id} firstName={p.firstName} /> : null}

          {/* Tomorrow */}
          <View style={[styles.sectionCard, { backgroundColor: colors.surface }, shadow.sm]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '700' }]}>Tomorrow</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{formatHeaderDate(offsetDate(1))}</Text>
            </View>

            {tomorrowAssignments.length > 0 ? (
              tomorrowAssignments.map((a) => {
                const timeStr = a.isFullDay ? 'Full Day' : `${formatTime(a.startTime)} – ${formatTime(a.endTime)}`;
                return (
                  <View key={a.id} style={{ marginTop: spacing.xs }}>
                    <View style={styles.assignmentDetailRow}>
                      <Icon name="map-pin" size={14} color={colors.textSecondary} />
                      <View style={{ marginLeft: spacing.xs }}>
                        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{a.project?.name}</Text>
                        {a.project?.address && (
                          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{a.project.address}</Text>
                        )}
                      </View>
                    </View>
                    <View style={[styles.assignmentDetailRow, { marginTop: spacing.xs }]}>
                      <Icon name="clock" size={14} color={colors.textSecondary} />
                      <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
                        {timeStr}{TRUCKS_ON ? ` · ${a.truck?.name ?? 'No truck assigned'}` : ''}
                      </Text>
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={[typeScale.bodySmall, { color: colors.textTertiary, marginTop: spacing.xs }]}>
                Not scheduled
              </Text>
            )}
          </View>

          {isActive && (
            <Pressable
              style={({ pressed }) => [styles.sectionCard, styles.resourceRow, { backgroundColor: colors.surface }, shadow.sm, pressed && { opacity: 0.92 }]}
              onPress={() => router.push(`/(owner)/worker-access?personId=${p.id}` as any)}
              accessibilityRole="button"
              accessibilityLabel="Manage resource access"
            >
              <View style={[styles.resourceIcon, { backgroundColor: colors.primarySurface }]}>
                <Icon name="key" size={18} color={colors.primaryOnWhite} />
              </View>
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>Manage Resource Access</Text>
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
                  {(() => {
                    const n = resourcesFor(p.id).length;
                    return n === 0 ? 'No company resources yet' : `Can open ${n} resource${n === 1 ? '' : 's'}`;
                  })()}
                </Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.textTertiary} />
            </Pressable>
          )}

          {isActive ? (
            <Pressable onPress={handleDeactivate} style={[styles.deactivateRow, { backgroundColor: semantic.errorLight }]}>
              <Icon name="user-x" size={16} color={semantic.error} />
              <Text style={[typeScale.labelLarge, { color: semantic.error, fontWeight: '700', marginLeft: spacing.xs }]}>
                Deactivate Worker
              </Text>
            </Pressable>
          ) : (
            <>
            <View style={[styles.deactivatedBanner, { backgroundColor: semantic.errorLight }]}>
              <Icon name="alert-circle" size={16} color={semantic.error} />
              <Text style={[typeScale.bodySmall, { color: semantic.error, flex: 1, marginLeft: spacing.sm }]}>
                This worker has been deactivated. Historical records are preserved.
              </Text>
            </View>
            <Pressable onPress={handleReactivate} style={[styles.deactivateRow, { backgroundColor: colors.primarySurface, marginTop: spacing.sm }]} accessibilityRole="button" accessibilityLabel="Reactivate worker">
              <Icon name="user-check" size={16} color={colors.primaryDark} />
              <Text style={[typeScale.labelLarge, { color: colors.primaryDark, fontWeight: '700', marginLeft: spacing.xs }]}>Reactivate Worker</Text>
            </Pressable>
            </>
          )}

          <Pressable onPress={handleDelete} style={[styles.deactivateRow, { backgroundColor: colors.backgroundTertiary }]} accessibilityRole="button" accessibilityLabel="Delete worker">
            <Icon name="trash-2" size={16} color={semantic.error} />
            <Text style={[typeScale.labelLarge, { color: semantic.error, fontWeight: '700', marginLeft: spacing.xs }]}>
              Delete Worker
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  crewChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  crewChoice: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1.5 },
  crewDot: { width: 8, height: 8, borderRadius: 4 },
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  backButton: { padding: spacing.xs },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingBottom: spacing['5xl'] },
  content: { paddingHorizontal: spacing.lg },
  profileCard: {
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  contactRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  contactBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radius.full,
  },
  sectionCard: {
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  assignmentBlock: {
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: 6,
  },
  assignmentTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  assignmentDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scheduleWorkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  resourceRow: { flexDirection: 'row', alignItems: 'center' },
  resourceIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  deactivateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  deactivatedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.sm,
    marginBottom: spacing.lg,
  },
});
