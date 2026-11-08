import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, Modal } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useSchedule } from '@/hooks/useSchedule';
import { Card, StatusBadge, Avatar, Divider, EmptyState, CrewLabels } from '@/components/ui';
import { useCrews } from '@/hooks/useCrews';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic, fixed, blackAlpha } from '@/theme/colors';
import type { Assignment, ScheduleSeries } from '@/types/schedule';
import { repeatShortLabel } from '@/lib/recurrence';
import { haptics } from '@/lib/haptics';
import { localDateKey } from '@/lib/ids';
import { useTodayKey } from '@/hooks/useTodayKey';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { confirmAction } from '@/components/financials/ActionSheet';
import { w } from '@/config/brand';

function formatDateTop(dateStr: string, today: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const t = new Date(today + 'T12:00:00');
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(time?: string): string {
  if (!time) return '';
  const [h, m] = time.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

function formatTimeRange(a: Assignment): string {
  return a.isFullDay ? 'Full Day' : `${formatTime(a.startTime)} – ${formatTime(a.endTime)}`;
}

function offsetDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return localDateKey(d);
}

const confirmBadge = (state: string) => {
  if (state === 'confirmed') return { label: 'Confirmed', status: 'success' as const };
  if (state === 'awaiting') return { label: 'Awaiting', status: 'warning' as const };
  if (state === 'updated_since') return { label: 'Updated', status: 'info' as const };
  return { label: 'Not Sent', status: 'neutral' as const };
};

export default function ScheduleScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const params = useLocalSearchParams<{ date?: string }>();
  // Worked out inside the screen (and again after midnight, on app resume and on focus), never once when the file loads.
  const today = useTodayKey();
  const [selectedDate, setSelectedDate] = useState(params.date ?? today);
  // If the day changes while the owner is looking at "today", follow it to the new day.
  const shownToday = useRef(today);
  useEffect(() => {
    const before = shownToday.current;
    shownToday.current = today;
    if (before !== today) setSelectedDate((cur) => (cur === before ? today : cur));
  }, [today]);
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);
  const [showIosPicker, setShowIosPicker] = useState(false);

  const schedule = useSchedule();
  const { crewsOf } = useCrews();
  const grouped = schedule.getGroupedByWorker(selectedDate);
  const allDayAssignments = schedule.getAllByDate(selectedDate);
  const cancelledCount = allDayAssignments.filter(a => a.status === 'cancelled' || a.status === 'reassigned').length;
  const weekData = schedule.weekSummary(getWeekStart(selectedDate));
  const selectedDateObj = useMemo(() => new Date(selectedDate + 'T12:00:00'), [selectedDate]);

  function handleCancel(assignment: Assignment) {
    const msg = `Cancel ${assignment.person?.firstName}'s assignment at ${assignment.project?.name}?`;
    if (Platform.OS === 'web') {
      const reason = prompt(msg + '\n\nReason (optional):');
      if (reason === null) return;
      haptics.destructive();
      schedule.cancelAssignment(assignment.id, reason || undefined);
      setSelectedAssignment(null);
    } else {
      confirmAction('Cancel Assignment', msg, 'Cancel Assignment', () => {
        haptics.destructive();
        schedule.cancelAssignment(assignment.id);
        setSelectedAssignment(null);
      }, true, 'Keep');
    }
  }

  function handleEndRepeat(assignment: Assignment) {
    if (!assignment.seriesId) return;
    const day = formatDateFull(assignment.scheduledDate);
    const msg = `${assignment.person?.firstName}'s repeating schedule at ${assignment.project?.name} stops after ${day}. Later days are cancelled; this day and earlier ones stay.`;
    const end = () => {
      haptics.destructive();
      schedule.endSeriesAfter(assignment.seriesId!, assignment.scheduledDate);
      setSelectedAssignment(null);
    };
    confirmAction('End Repeat', msg, 'End Repeat', end, true, 'Keep Repeating');
  }

  function handleMove(assignment: Assignment) {
    setSelectedAssignment(null);
    router.push(`/(owner)/schedule-create?moveFrom=${assignment.id}&workerId=${assignment.personId}&date=${selectedDate}` as any);
  }

  function handleViewProject(assignment: Assignment) {
    setSelectedAssignment(null);
    router.push(`/(owner)/projects/${assignment.projectId}` as any);
  }

  function handleDatePicked(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === 'android') setShowAndroidPicker(false);
    if (event.type === 'dismissed' || !date) return;
    setSelectedDate(localDateKey(date));
  }

  function renderDayView() {
    const workerIds = Object.keys(grouped);

    if (workerIds.length === 0) {
      return (
        <EmptyState
          icon="calendar"
          title="No assignments scheduled"
          description="Nobody is scheduled to work on this day yet."
          actionTitle="Create Assignment"
          onAction={() => router.push(`/(owner)/schedule-create?date=${selectedDate}` as any)}
        />
      );
    }

    return (
      <>
        {workerIds.map((workerId) => {
          const group = grouped[workerId];
          const person = group.person!;
          const travelWarnings = schedule.detectTravelWarnings(workerId, selectedDate);
          const workerCrews = crewsOf(workerId);

          return (
            <Card key={workerId} style={styles.workerCard} noPadding>
              <View style={styles.workerHeader}>
                <Avatar firstName={person.firstName} lastName={person.lastName} size={32} uri={person.avatarUrl} />
                <View style={{ flex: 1 }}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>
                    {person.firstName} {person.lastName}
                  </Text>
                  <CrewLabels crews={workerCrews} style={{ marginTop: 2 }} />
                  {group.truck && (
                    <View style={styles.truckRow}>
                      <Icon name="truck" size={11} color={colors.textTertiary} />
                      <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{group.truck.name}</Text>
                    </View>
                  )}
                </View>
                {group.assignments.length === 1 && (() => {
                  const badge = confirmBadge(group.assignments[0].confirmationState);
                  return <StatusBadge label={badge.label} status={badge.status} style={styles.headerBadge} />;
                })()}
              </View>

              <View style={styles.assignmentList}>
                {group.assignments.map((a) => {
                  const badge = confirmBadge(a.confirmationState);
                  return (
                    <Pressable
                      key={a.id}
                      style={({ pressed }) => [
                        styles.assignmentRow,
                        { backgroundColor: colors.backgroundTertiary },
                        pressed && { opacity: 0.85 },
                      ]}
                      onPress={() => setSelectedAssignment(a)}
                      accessibilityRole="button"
                      accessibilityLabel={`${a.project?.name ?? 'Assignment'}, ${formatTimeRange(a)}`}
                    >
                      <Text style={[typeScale.caption, styles.timeCol, { color: colors.textSecondary, fontWeight: '600' }]}>
                        {formatTimeRange(a)}
                      </Text>
                      <Icon name="home" size={13} color={colors.textTertiary} />
                      <View style={{ flex: 1 }}>
                        <View style={styles.projectNameRow}>
                          <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600', flexShrink: 1 }]} numberOfLines={1}>
                            {a.project?.name ?? w('Unknown job')}
                          </Text>
                          {a.seriesId && (
                            <Icon name="repeat" size={11} color={colors.primary} />
                          )}
                        </View>
                        {a.project?.address && (
                          <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>
                            {a.project.address}
                          </Text>
                        )}
                      </View>
                      {group.assignments.length > 1 && <StatusBadge label={badge.label} status={badge.status} />}
                      <Icon name="chevron-right" size={15} color={colors.textTertiary} />
                    </Pressable>
                  );
                })}
              </View>

              {travelWarnings.length > 0 && (
                <View style={[styles.travelWarning, { backgroundColor: semantic.warningLight, borderColor: semantic.warning }]}>
                  <Icon name="clock" size={13} color={semantic.warning} />
                  <Text style={[typeScale.caption, { color: colors.textPrimary, flex: 1 }]}>
                    {travelWarnings[0].availableMinutes} min gap between {travelWarnings[0].fromAssignment.project?.name} and {travelWarnings[0].toAssignment.project?.name}
                  </Text>
                </View>
              )}
            </Card>
          );
        })}

        {cancelledCount > 0 && (
          <Text style={[typeScale.caption, { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.sm }]}>
            {cancelledCount} cancelled/reassigned assignment{cancelledCount > 1 ? 's' : ''} not shown
          </Text>
        )}
      </>
    );
  }

  function renderWeekView() {
    return (
      <>
        {weekData.map((day) => {
          const isToday = day.date === today;
          const isSelected = day.date === selectedDate;
          return (
            <Pressable
              key={day.date}
              style={[
                styles.weekRow,
                { borderBottomColor: colors.borderLight },
                isSelected && { backgroundColor: colors.primarySurface },
              ]}
              onPress={() => { setSelectedDate(day.date); setViewMode('day'); }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[
                  typeScale.bodySmall,
                  { color: isToday ? colors.primary : colors.textPrimary, fontWeight: isToday ? '700' : '500' },
                ]}>
                  {day.label}{isToday ? ' (Today)' : ''}
                </Text>
                {day.workerCount > 0 ? (
                  <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                    {day.workerCount} worker{day.workerCount > 1 ? 's' : ''} · {day.projectCount} {w(day.projectCount > 1 ? 'jobs' : 'job')}
                  </Text>
                ) : (
                  <Text style={[typeScale.caption, { color: colors.textTertiary }]}>No assignments</Text>
                )}
              </View>
              {day.hasIssues && (
                <View style={[styles.issueDot, { backgroundColor: semantic.warning }]} />
              )}
              <Icon name="chevron-right" size={16} color={colors.textTertiary} />
            </Pressable>
          );
        })}
      </>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1 }]}>Schedule</Text>
        <Pressable
          onPress={() => router.push(`/(owner)/schedule-create?date=${selectedDate}` as any)}
          style={[styles.plusBtn, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel="Create assignment"
        >
          <Icon name="plus" size={20} color={colors.textOnPrimary} />
        </Pressable>
      </View>

      <View style={styles.dateNav}>
        <Pressable
          onPress={() => setSelectedDate(offsetDateStr(selectedDate, viewMode === 'week' ? -7 : -1))}
          accessibilityRole="button"
          accessibilityLabel="Previous"
          hitSlop={8}
        >
          <Icon name="chevron-left" size={22} color={colors.textPrimary} />
        </Pressable>

        {viewMode === 'week' ? (
          <Pressable onPress={() => setSelectedDate(today)} style={styles.dateCenter}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
              {`Week of ${new Date(getWeekStart(selectedDate) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => { if (Platform.OS === 'android') setShowAndroidPicker(true); else if (Platform.OS === 'ios') setShowIosPicker(true); else setSelectedDate(today); }}
            style={styles.dateCenter}
            accessibilityRole="button"
            accessibilityLabel="Choose date"
          >
            <View style={styles.dateCenterTopRow}>
              <Icon name="calendar" size={13} color={colors.textSecondary} />
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '700' }]}>
                {formatDateTop(selectedDate, today)}
              </Text>
            </View>
            <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{formatDateFull(selectedDate)}</Text>
          </Pressable>
        )}

        <Pressable
          onPress={() => setSelectedDate(offsetDateStr(selectedDate, viewMode === 'week' ? 7 : 1))}
          accessibilityRole="button"
          accessibilityLabel="Next"
          hitSlop={8}
        >
          <Icon name="chevron-right" size={22} color={colors.textPrimary} />
        </Pressable>
      </View>

      {Platform.OS === 'android' && showAndroidPicker && (
        <DateTimePicker value={selectedDateObj} mode="date" display="default" onChange={handleDatePicked} />
      )}
      {Platform.OS === 'ios' && (
        <BottomSheetModal visible={showIosPicker} onRequestClose={() => setShowIosPicker(false)}>
          <Pressable style={styles.pickerOverlay} onPress={() => setShowIosPicker(false)}>
            <Pressable style={[styles.pickerCard, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md }]} onPress={(e) => e.stopPropagation()}>
              <View style={styles.pickerHeader}>
                <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>Go to Date</Text>
                <Pressable onPress={() => setShowIosPicker(false)} hitSlop={12} accessibilityRole="button">
                  <Text style={[typeScale.labelLarge, { color: colors.primary }]}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={selectedDateObj}
                mode="date"
                display="inline"
                accentColor={colors.primary}
                onChange={(e: DateTimePickerEvent, d?: Date) => { handleDatePicked(e, d); setShowIosPicker(false); }}
              />
            </Pressable>
          </Pressable>
        </BottomSheetModal>
      )}

      <View style={styles.segmentWrap}>
        <SegmentedControl
          values={['Day', 'Week']}
          selectedIndex={viewMode === 'day' ? 0 : 1}
          onChange={(event) => setViewMode(event.nativeEvent.selectedSegmentIndex === 0 ? 'day' : 'week')}
          tintColor={colors.primary}
          appearance="light"
          backgroundColor={colors.groupedBackground}
          fontStyle={{ color: colors.textSecondary }}
          activeFontStyle={{ color: fixed.white, fontWeight: '600' }}
          style={styles.segmentControl}
        />
      </View>

      <ScrollView bounces={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
        {viewMode === 'day' ? renderDayView() : renderWeekView()}
      </ScrollView>

      <AssignmentSheet
        assignment={selectedAssignment}
        onClose={() => setSelectedAssignment(null)}
        onMove={handleMove}
        onCancel={handleCancel}
        onViewProject={handleViewProject}
        onEndRepeat={handleEndRepeat}
        series={selectedAssignment?.seriesId ? schedule.series.find(s => s.id === selectedAssignment.seriesId) : undefined}
      />
    </View>
  );
}

function AssignmentSheet({
  assignment,
  onClose,
  onMove,
  onCancel,
  onViewProject,
  onEndRepeat,
  series,
}: {
  assignment: Assignment | null;
  onClose: () => void;
  onMove: (a: Assignment) => void;
  onCancel: (a: Assignment) => void;
  onViewProject: (a: Assignment) => void;
  onEndRepeat: (a: Assignment) => void;
  series?: ScheduleSeries;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const visible = !!assignment;

  const body = assignment && (
    <View style={[styles.sheetBody, { paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.sheetHeaderRow}>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1 }]}>Assignment</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
          <Icon name="x" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.sheetProjectRow}>
        <Icon name="home" size={16} color={colors.textSecondary} />
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
            {assignment.project?.name ?? w('Unknown job')}
          </Text>
          {assignment.project?.address && (
            <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>{assignment.project.address}</Text>
          )}
        </View>
      </View>

      <Divider />

      <View style={styles.sheetDetailRow}>
        <Icon name="clock" size={16} color={colors.textSecondary} />
        <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>{formatTimeRange(assignment)}</Text>
      </View>

      {assignment.person && (
        <View style={styles.sheetDetailRow}>
          <Avatar firstName={assignment.person.firstName} lastName={assignment.person.lastName} size={22} uri={assignment.person.avatarUrl} />
          <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>
            {assignment.person.firstName} {assignment.person.lastName}
          </Text>
        </View>
      )}

      {assignment.truck && (
        <View style={styles.sheetDetailRow}>
          <Icon name="truck" size={16} color={colors.textSecondary} />
          <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>{assignment.truck.name}</Text>
        </View>
      )}

      {series && (
        <View style={styles.sheetDetailRow}>
          <Icon name="repeat" size={16} color={colors.textSecondary} />
          <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>
            {series.stoppedAt
              ? `Repeat ended${series.endDate ? ` after ${formatDateFull(series.endDate)}` : ''}`
              : `Repeats ${repeatShortLabel(series).toLowerCase()}${series.endDate ? ` until ${formatDateFull(series.endDate)}` : ''}`}
          </Text>
        </View>
      )}

      <View style={styles.sheetDetailRow}>
        <Icon name="check-circle" size={16} color={colors.textSecondary} />
        {(() => {
          const badge = confirmBadge(assignment.confirmationState);
          return <StatusBadge label={badge.label} status={badge.status} />;
        })()}
      </View>

      <Divider />

      <Pressable style={styles.sheetActionRow} onPress={() => onMove(assignment)} accessibilityRole="button">
        <Icon name="arrow-right-circle" size={18} color={colors.primary} />
        <Text style={[typeScale.bodyLarge, { color: colors.primary, flex: 1 }]}>Move Assignment</Text>
        <Icon name="chevron-right" size={16} color={colors.textTertiary} />
      </Pressable>

      <Pressable style={styles.sheetActionRow} onPress={() => onViewProject(assignment)} accessibilityRole="button">
        <Icon name="external-link" size={18} color={colors.textPrimary} />
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>{w('View Job')}</Text>
        <Icon name="chevron-right" size={16} color={colors.textTertiary} />
      </Pressable>

      <Pressable style={styles.sheetActionRow} onPress={() => onCancel(assignment)} accessibilityRole="button">
        <Icon name="x-circle" size={18} color={semantic.error} />
        <Text style={[typeScale.bodyLarge, { color: semantic.error, flex: 1 }]}>
          {series && !series.stoppedAt ? 'Cancel This Day' : 'Cancel Assignment'}
        </Text>
      </Pressable>

      {series && !series.stoppedAt && (
        <Pressable style={styles.sheetActionRow} onPress={() => onEndRepeat(assignment)} accessibilityRole="button">
          <Icon name="slash" size={18} color={semantic.error} />
          <Text style={[typeScale.bodyLarge, { color: semantic.error, flex: 1 }]}>End Repeat After This Day</Text>
        </Pressable>
      )}
    </View>
  );

  if (Platform.OS === 'ios') {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <View style={[styles.sheetIosContainer, { backgroundColor: colors.surfaceElevated }]}>{body}</View>
      </Modal>
    );
  }

  return (
    <BottomSheetModal visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose}>
        <Pressable style={[styles.sheetCard, { backgroundColor: colors.surfaceElevated }]} onPress={(e) => e.stopPropagation()}>
          <View style={[styles.sheetGrabber, { backgroundColor: colors.border }]} />
          {body}
        </Pressable>
      </Pressable>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  backButton: { padding: spacing.xs },
  plusBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dateNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  dateCenter: { alignItems: 'center' },
  dateCenterTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  pickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: blackAlpha(0.4) },
  pickerCard: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  segmentWrap: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  segmentControl: {
    height: 34,
  },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing['5xl'] },
  workerCard: { marginBottom: spacing.md, padding: spacing.md },
  workerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerBadge: { alignSelf: 'flex-start' },
  truckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  assignmentList: { gap: spacing.xs },
  assignmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
  },
  timeCol: { width: 64 },
  travelWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderLeftWidth: 2,
    marginTop: spacing.sm,
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  issueDot: { width: 8, height: 8, borderRadius: 4 },

  sheetIosContainer: { flex: 1 },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: blackAlpha(0.4) },
  sheetCard: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    ...shadow.lg,
  },
  sheetGrabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
  sheetBody: { padding: spacing.lg, gap: spacing.md },
  sheetHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  sheetProjectRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  sheetDetailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sheetActionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  projectNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
