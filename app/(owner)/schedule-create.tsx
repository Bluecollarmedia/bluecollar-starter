import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, Modal } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useSchedule } from '@/hooks/useSchedule';
import { Input, Avatar, CrewLabels } from '@/components/ui';
import { useCrews } from '@/hooks/useCrews';
import { CrewChips, type CrewPerson } from '@/components/crews/CrewChips';
import { bookedOn } from '@/lib/crewBooking';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic, fixed, blackAlpha } from '@/theme/colors';
import { db, useDb } from '@/data/store';
import { todayKey, localDateKey } from '@/lib/ids';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import type { RepeatFrequency } from '@/types/schedule';
import {
  addMonthsKey, describeHorizon, describeRepeat, occurrenceDates, HORIZON_OPTIONS, SERIES_HORIZON_DAYS,
} from '@/lib/recurrence';
import { showMessage } from '@/components/financials/ActionSheet';
import { isFeatureOn, w } from '@/config/brand';

const today = todayKey();

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const REPEAT_OPTIONS: { label: string; value: RepeatFrequency | 'none' }[] = [
  { label: 'Never', value: 'none' },
  { label: 'Weekly', value: 'weekly' },
  { label: '2 Weeks', value: 'biweekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Custom', value: 'custom' },
];

const CUSTOM_LIMITS = { days: { min: 2, max: 365 }, weeks: { min: 1, max: 52 } };

function formatTime(time?: string): string {
  if (!time) return '';
  const [h, m] = time.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

function formatAssignmentTime(a: { isFullDay: boolean; startTime?: string; endTime?: string }): string {
  return a.isFullDay ? 'Full Day' : `${formatTime(a.startTime)} – ${formatTime(a.endTime)}`;
}

function timeStrToDate(dateStr: string, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(dateStr + 'T12:00:00');
  d.setHours(h, m, 0, 0);
  return d;
}

function dateToTimeStr(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Repeat jobs (every week, etc.) are reachable only when the settings file switches them on (src/config/brand.js, features.repeatJobs).
 *  Off (the default): a job or a one-off visit is scheduled day by day. */
const ALLOW_REPEAT = isFeatureOn('repeatJobs');

export default function ScheduleCreateScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    workerId?: string;
    projectId?: string;
    date?: string;
    moveFrom?: string;
  }>();
  const isMove = !!params.moveFrom;
  // Opened from inside a project: the project is already known, so it is not asked again (the id is bound here in the background).
  const projectKnown = !isMove && !!params.projectId;

  const schedule = useSchedule();
  const { crews, crewsOf } = useCrews();

  const v = useDb();
  const activeWorkers = useMemo(() =>
    db.members.filter(m => m.role === 'worker' && m.status === 'active' && !!m.person),
  [v]);
  const activeProjects = useMemo(() =>
    db.projects.filter(p => p.status === 'active'),
  [v]);
  const availableTrucks = useMemo(() =>
    db.trucks.filter(t => t.status !== 'out_of_service'),
  [v]);

  const [projectId, setProjectId] = useState(params.projectId ?? '');
  const [workerIds, setWorkerIds] = useState<string[]>(params.workerId ? [params.workerId] : []);
  const [date, setDate] = useState(params.date ?? today);
  // A day's work is a full day unless the owner picks hours.
  const [isFullDay, setIsFullDay] = useState(true);
  const [startTime, setStartTime] = useState('07:00');
  const [endTime, setEndTime] = useState('15:00');
  const [truckId, setTruckId] = useState('');
  const [notes, setNotes] = useState('');
  const [repeat, setRepeat] = useState<RepeatFrequency | 'none'>('none');
  const [customCount, setCustomCount] = useState(10);
  const [customUnit, setCustomUnit] = useState<'days' | 'weeks'>('days');
  const [horizonDays, setHorizonDays] = useState(SERIES_HORIZON_DAYS);
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState(() => addMonthsKey(params.date ?? today, 3));

  const [showProjectSheet, setShowProjectSheet] = useState(false);
  const [showTruckSheet, setShowTruckSheet] = useState(false);
  const [showAndroidDate, setShowAndroidDate] = useState(false);
  const [showAndroidEndDate, setShowAndroidEndDate] = useState(false);
  const [iosPicker, setIosPicker] = useState<'date' | 'start' | 'end' | 'endDate' | null>(null);
  const [showAndroidStart, setShowAndroidStart] = useState(false);
  const [showAndroidEnd, setShowAndroidEnd] = useState(false);

  const dateObj = useMemo(() => new Date(date + 'T12:00:00'), [date]);
  const endDateObj = useMemo(() => new Date(endDate + 'T12:00:00'), [endDate]);
  const isRepeating = !isMove && repeat !== 'none';
  const intervalDays = customUnit === 'weeks' ? customCount * 7 : customCount;
  const repeatRule = { frequency: repeat as RepeatFrequency, intervalDays: repeat === 'custom' ? intervalDays : undefined };

  function stepCustom(delta: number) {
    const { min, max } = CUSTOM_LIMITS[customUnit];
    setCustomCount(n => Math.min(max, Math.max(min, n + delta)));
  }

  function setUnit(unit: 'days' | 'weeks') {
    if (unit === customUnit) return;
    // Keep roughly the same gap when switching units.
    const next = unit === 'weeks' ? Math.max(1, Math.round(customCount / 7)) : Math.max(2, customCount * 7);
    const { min, max } = CUSTOM_LIMITS[unit];
    setCustomUnit(unit);
    setCustomCount(Math.min(max, Math.max(min, next)));
  }
  // The first few days the repeat lands on, for the preview.
  const upcomingDays = useMemo(() => {
    if (repeat === 'none') return [];
    return occurrenceDates({ ...repeatRule, startDate: date, endDate: hasEndDate ? endDate : undefined }, date, '9999-12-31', 4);
  }, [repeat, intervalDays, date, hasEndDate, endDate]);
  const startTimeObj = useMemo(() => timeStrToDate(date, startTime), [date, startTime]);
  const endTimeObj = useMemo(() => timeStrToDate(date, endTime), [date, endTime]);

  const selectedProject = activeProjects.find(p => p.id === projectId);
  const selectedTruck = availableTrucks.find(t => t.id === truckId);
  const selectedWorkers = workerIds
    .map(id => activeWorkers.find(w => w.personId === id))
    .filter((w): w is NonNullable<typeof w> => !!w);

  const truckConflicts = useMemo(() => {
    if (!truckId) return [];
    return workerIds.flatMap(personId =>
      schedule.detectConflicts({
        personId,
        scheduledDate: date,
        startTime: isFullDay ? undefined : startTime,
        endTime: isFullDay ? undefined : endTime,
        isFullDay,
        truckId,
      }).filter(c => c.type === 'truck_overlap')
    );
  }, [truckId, workerIds, date, isFullDay, startTime, endTime, schedule]);

  // A worker can only be on a given job once per day. Returns their existing
  // assignment on that job and date, if any.
  function existingOnJob(personId: string, pid: string, d: string, excludeId?: string) {
    if (!pid) return undefined;
    return schedule.getByWorker(personId, d).find(a => a.projectId === pid && a.id !== excludeId);
  }

  function showAlreadyScheduled(names: string[], d: string) {
    const who = names.length === 1 ? `${names[0]} is` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are`;
    const msg = `${who} already scheduled at ${selectedProject?.name ?? w('this job')} on ${formatDateFull(d)}. Edit the existing assignment instead.`;
    showMessage('Already Scheduled', msg);
  }

  /** Whether a crew member can be added by a crew tap: active, not already on this job, and not out on another job that day. */
  function crewCheck(pid: string): CrewPerson {
    if (!activeWorkers.some(w => w.personId === pid) || existingOnJob(pid, projectId, date)) return { ok: false };
    const busy = bookedOn(pid, date);
    return busy ? { ok: false, reason: `is already on ${busy} that day` } : { ok: true };
  }

  function toggleWorker(personId: string) {
    setWorkerIds(prev => prev.includes(personId) ? prev.filter(id => id !== personId) : [...prev, personId]);
  }

  function handleCreate() {
    if (isMove) {
      if (!projectId) {
        const msg = w('Please select a job.');
        showMessage('Required', msg);
        return;
      }
      const original = schedule.assignments.find(a => a.id === params.moveFrom);
      if (original && existingOnJob(original.personId, projectId, original.scheduledDate, original.id)) {
        showAlreadyScheduled([original.person?.firstName ?? 'This worker'], original.scheduledDate);
        return;
      }
      schedule.moveWorker(params.moveFrom!, projectId, notes || undefined);
      router.back();
      return;
    }

    if (!projectId || workerIds.length === 0) {
      const msg = w('Please select a job and at least one worker.');
      showMessage('Required', msg);
      return;
    }

    const alreadyOnJob = selectedWorkers.filter(w => existingOnJob(w.personId, projectId, date));
    if (alreadyOnJob.length > 0) {
      showAlreadyScheduled(alreadyOnJob.map(w => w.person!.firstName), date);
      return;
    }

    if (isRepeating) {
      if (hasEndDate && endDate < date) {
        const msg = 'The end date has to be on or after the first day.';
        showMessage('Check the End Date', msg);
        return;
      }
      for (const personId of workerIds) {
        schedule.createSeries({
          personId,
          projectId,
          scheduledDate: date,
          startTime: isFullDay ? undefined : startTime,
          endTime: isFullDay ? undefined : endTime,
          isFullDay,
          truckId: truckId || undefined,
          notes: notes || undefined,
          frequency: repeat as RepeatFrequency,
          intervalDays: repeat === 'custom' ? intervalDays : undefined,
          horizonDays,
          endDate: hasEndDate ? endDate : undefined,
        });
      }
      router.back();
      return;
    }

    for (const personId of workerIds) {
      schedule.createAssignment({
        personId,
        projectId,
        scheduledDate: date,
        startTime: isFullDay ? undefined : startTime,
        endTime: isFullDay ? undefined : endTime,
        isFullDay,
        truckId: truckId || undefined,
        notes: notes || undefined,
      });
    }

    router.back();
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <KeyboardAwareScrollView bounces={false} bottomOffset={KEYBOARD_GAP} contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + spacing.lg }]} showsVerticalScrollIndicator={false}>
        <View style={styles.titleRow}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.closeButton, { backgroundColor: colors.surface }, shadow.sm]}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Icon name="x" size={20} color={colors.textPrimary} />
          </Pressable>
        </View>
        <Text style={[typeScale.displayLarge, { color: colors.textPrimary, marginTop: spacing.md }]}>
          {isMove ? 'Move Worker' : 'Schedule Work'}
        </Text>
        <Text style={[typeScale.bodyLarge, { color: colors.textTertiary, marginTop: 2 }]}>
          {isMove ? w('Reassign this worker to a different job') : projectKnown && selectedProject ? `For ${selectedProject.name}` : w('Assign your crew to a job')}
        </Text>

        {/* Workers: first, and the whole list is right here (no second screen to open) */}
        <Section
          icon="users"
          title="Workers"
          required={!isMove}
          accessoryLabel={isMove ? undefined : (workerIds.length > 0 ? `${workerIds.length} selected` : undefined)}
        >
          {isMove && selectedWorkers.length > 0 ? (
            <View style={styles.workerChips}>
              {selectedWorkers.map(w => (
                <View key={w.personId} style={[styles.workerChip, { backgroundColor: colors.backgroundTertiary }]}>
                  <Avatar firstName={w.person!.firstName} lastName={w.person!.lastName} size={26} uri={w.person!.avatarUrl} />
                  <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>{w.person!.firstName}</Text>
                  {!isMove && (
                    <Pressable onPress={() => toggleWorker(w.personId)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${w.person!.firstName}`}>
                      <Icon name="x" size={14} color={colors.textTertiary} />
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          ) : null}
          {!isMove && selectedWorkers.some(w => existingOnJob(w.personId, projectId, date)) && (
            <View style={[styles.conflictBox, { backgroundColor: semantic.warningLight, borderColor: semantic.warning }]}>
              <Icon name="alert-triangle" size={14} color={semantic.warning} />
              <Text style={[typeScale.caption, { color: colors.textPrimary, flex: 1 }]}>
                {selectedWorkers.filter(w => existingOnJob(w.personId, projectId, date)).map(w => w.person!.firstName).join(', ')} already scheduled at {selectedProject?.name} on this day.
              </Text>
            </View>
          )}
          {!isMove ? <CrewChips crews={crews} picked={workerIds} onChange={setWorkerIds} check={crewCheck} /> : null}
          {!isMove ? (
            <View>
        {activeWorkers.map(w => {
          const p = w.person!;
          const workerCrews = crewsOf(w.personId);
          const selected = workerIds.includes(w.personId);
          const conflicts = schedule.detectConflicts({
            personId: w.personId,
            scheduledDate: date,
            startTime: isFullDay ? undefined : startTime,
            endTime: isFullDay ? undefined : endTime,
            isFullDay,
          }).filter(c => c.type === 'time_overlap');
          const conflict = conflicts[0];
          const onJob = existingOnJob(w.personId, projectId, date);
          const showAsUnavailable = !!conflict && !selected && !onJob;

          return (
            <Pressable
              key={w.personId}
              style={[styles.workerPickerRow, (showAsUnavailable || (onJob && !selected)) && { opacity: 0.55 }]}
              onPress={() => toggleWorker(w.personId)}
              disabled={!!onJob && !selected}
              accessibilityRole="button"
              accessibilityLabel={`${p.firstName} ${p.lastName}${onJob ? ', already on this job' : conflict ? ', unavailable' : ''}`}
            >
              <Avatar firstName={p.firstName} lastName={p.lastName} size={36} uri={p.avatarUrl} />
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>
                  {p.firstName} {p.lastName}
                </Text>
                <CrewLabels crews={workerCrews} style={{ marginTop: 2 }} />
                {onJob ? (
                  <>
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                      Scheduled {formatAssignmentTime(onJob)} · {onJob.project?.name}
                    </Text>
                    <Text style={[typeScale.caption, { color: semantic.warning, fontWeight: '700' }]}>Already on this job</Text>
                  </>
                ) : conflict && (
                  <>
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                      Scheduled {formatAssignmentTime(conflict.assignment)} · {conflict.assignment.project?.name}
                    </Text>
                    <Text style={[typeScale.caption, { color: semantic.warning, fontWeight: '700' }]}>Unavailable</Text>
                  </>
                )}
              </View>
              {showAsUnavailable ? (
                <View style={[styles.overridePill, { borderColor: semantic.warning }]}>
                  <Text style={[typeScale.caption, { color: semantic.warning, fontWeight: '700' }]}>Select Anyway</Text>
                </View>
              ) : (
                <Icon name={selected ? 'check-circle' : 'circle'} size={24} color={selected ? colors.primary : colors.border} />
              )}
            </Pressable>
          );
        })}
            </View>
          ) : null}
        </Section>

        {/* Project: only asked when this was not opened from inside a project */}
        {projectKnown ? null : (
        <Section
          icon="home"
          title={w('Job')}
          required
          accessoryLabel={selectedProject ? undefined : w('Select Job')}
          onPressAccessory={() => setShowProjectSheet(true)}
        >
          {selectedProject ? (
            <Pressable style={styles.projectPreview} onPress={() => setShowProjectSheet(true)}>
              <View style={[styles.projectIconWrap, { backgroundColor: colors.primarySurface }]}>
                <Icon name="home" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={1}>
                  {selectedProject.name}
                </Text>
                {selectedProject.address && (
                  <View style={styles.inlineRow}>
                    <Icon name="map-pin" size={11} color={colors.textTertiary} />
                    <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>
                      {selectedProject.address}
                    </Text>
                  </View>
                )}
              </View>
              <Icon name="chevron-right" size={16} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </Section>
        )}

        {!isMove && (
          <>
            {/* Date */}
            <Section icon="calendar" title="Date" required>
              <Pressable
                style={styles.fieldRow}
                onPress={() => (Platform.OS === 'android' ? setShowAndroidDate(true) : setIosPicker('date'))}
                accessibilityRole="button"
                accessibilityLabel="Choose date"
              >
                <Icon name="calendar" size={15} color={colors.textSecondary} />
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600', flex: 1 }]}>
                  {formatDateFull(date)}
                </Text>
                <Icon name="chevron-right" size={16} color={colors.textTertiary} />
              </Pressable>
              {Platform.OS === 'android' && showAndroidDate && (
                <DateTimePicker
                  value={dateObj}
                  mode="date"
                  display="default"
                  onChange={(_e: DateTimePickerEvent, d?: Date) => { setShowAndroidDate(false); if (d) setDate(localDateKey(d)); }}
                />
              )}
            </Section>

            {/* Time */}
            <Section icon="clock" title="Time" required>
              <SegmentedControl
                values={['Set Time', 'Full Day']}
                selectedIndex={isFullDay ? 1 : 0}
                onChange={(event) => setIsFullDay(event.nativeEvent.selectedSegmentIndex === 1)}
                tintColor={colors.primary}
                appearance="light"
                backgroundColor={colors.groupedBackground}
                fontStyle={{ color: colors.textSecondary }}
                activeFontStyle={{ color: fixed.white, fontWeight: '600' }}
                style={styles.segmentControl}
              />

              {!isFullDay && (
                <View style={styles.timeRow}>
                  <Pressable
                    style={[styles.timeField, { backgroundColor: colors.backgroundTertiary }]}
                    onPress={() => (Platform.OS === 'android' ? setShowAndroidStart(true) : setIosPicker('start'))}
                    accessibilityRole="button"
                    accessibilityLabel="Choose start time"
                  >
                    <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Start</Text>
                    <View style={styles.inlineRow}>
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{formatTime(startTime)}</Text>
                      <Icon name="chevron-right" size={14} color={colors.textTertiary} />
                    </View>
                  </Pressable>
                  <Pressable
                    style={[styles.timeField, { backgroundColor: colors.backgroundTertiary }]}
                    onPress={() => (Platform.OS === 'android' ? setShowAndroidEnd(true) : setIosPicker('end'))}
                    accessibilityRole="button"
                    accessibilityLabel="Choose end time"
                  >
                    <Text style={[typeScale.caption, { color: colors.textTertiary }]}>End</Text>
                    <View style={styles.inlineRow}>
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{formatTime(endTime)}</Text>
                      <Icon name="chevron-right" size={14} color={colors.textTertiary} />
                    </View>
                  </Pressable>
                </View>
              )}
              {Platform.OS === 'android' && showAndroidStart && (
                <DateTimePicker
                  value={startTimeObj}
                  mode="time"
                  display="default"
                  onChange={(_e: DateTimePickerEvent, d?: Date) => { setShowAndroidStart(false); if (d) setStartTime(dateToTimeStr(d)); }}
                />
              )}
              {Platform.OS === 'android' && showAndroidEnd && (
                <DateTimePicker
                  value={endTimeObj}
                  mode="time"
                  display="default"
                  onChange={(_e: DateTimePickerEvent, d?: Date) => { setShowAndroidEnd(false); if (d) setEndTime(dateToTimeStr(d)); }}
                />
              )}
            </Section>

            {/* Repeat: only when features.repeatJobs is on (ALLOW_REPEAT). Otherwise jobs go day by day. */}
            {ALLOW_REPEAT ? (
            <Section icon="repeat" title="Repeat">
              <SegmentedControl
                values={REPEAT_OPTIONS.map(o => o.label)}
                selectedIndex={REPEAT_OPTIONS.findIndex(o => o.value === repeat)}
                onChange={(event) => setRepeat(REPEAT_OPTIONS[event.nativeEvent.selectedSegmentIndex].value)}
                tintColor={colors.primary}
                appearance="light"
                backgroundColor={colors.groupedBackground}
                fontStyle={{ color: colors.textSecondary }}
                activeFontStyle={{ color: fixed.white, fontWeight: '600' }}
                style={styles.segmentControl}
              />

              {repeat !== 'none' && (
                <>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600', marginTop: spacing.xs }]}>
                    {describeRepeat(repeatRule, date)}
                  </Text>

                  {repeat === 'custom' && (
                    <View style={styles.customRow}>
                      <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>Every</Text>
                      <View style={[styles.stepper, { backgroundColor: colors.backgroundTertiary }]}>
                        <Pressable
                          onPress={() => stepCustom(-1)}
                          style={({ pressed }) => [styles.stepperButton, pressed && { opacity: 0.5 }]}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel={`Fewer ${customUnit}`}
                        >
                          <Icon name="minus" size={16} color={colors.textPrimary} />
                        </Pressable>
                        <Text style={[typeScale.headingSmall, styles.stepperValue, { color: colors.textPrimary }]}>{customCount}</Text>
                        <Pressable
                          onPress={() => stepCustom(1)}
                          style={({ pressed }) => [styles.stepperButton, pressed && { opacity: 0.5 }]}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel={`More ${customUnit}`}
                        >
                          <Icon name="plus" size={16} color={colors.textPrimary} />
                        </Pressable>
                      </View>
                      <SegmentedControl
                        values={['Days', 'Weeks']}
                        selectedIndex={customUnit === 'weeks' ? 1 : 0}
                        onChange={(event) => setUnit(event.nativeEvent.selectedSegmentIndex === 1 ? 'weeks' : 'days')}
                        tintColor={colors.primary}
                        appearance="light"
                        backgroundColor={colors.groupedBackground}
                        fontStyle={{ color: colors.textSecondary }}
                        activeFontStyle={{ color: fixed.white, fontWeight: '600' }}
                        style={[styles.segmentControl, { flex: 1 }]}
                      />
                    </View>
                  )}

                  <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>Schedule ahead</Text>
                  <SegmentedControl
                    values={HORIZON_OPTIONS.map(o => o.label)}
                    selectedIndex={Math.max(0, HORIZON_OPTIONS.findIndex(o => o.days === horizonDays))}
                    onChange={(event) => setHorizonDays(HORIZON_OPTIONS[event.nativeEvent.selectedSegmentIndex].days)}
                    tintColor={colors.primary}
                    appearance="light"
                    backgroundColor={colors.groupedBackground}
                    fontStyle={{ color: colors.textSecondary }}
                    activeFontStyle={{ color: fixed.white, fontWeight: '600' }}
                    style={styles.segmentControl}
                  />

                  <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>Ends</Text>

                  <SegmentedControl
                    values={['No End Date', 'End Date']}
                    selectedIndex={hasEndDate ? 1 : 0}
                    onChange={(event) => setHasEndDate(event.nativeEvent.selectedSegmentIndex === 1)}
                    tintColor={colors.primary}
                    appearance="light"
                    backgroundColor={colors.groupedBackground}
                    fontStyle={{ color: colors.textSecondary }}
                    activeFontStyle={{ color: fixed.white, fontWeight: '600' }}
                    style={styles.segmentControl}
                  />

                  {hasEndDate && (
                    <Pressable
                      style={styles.fieldRow}
                      onPress={() => (Platform.OS === 'android' ? setShowAndroidEndDate(true) : setIosPicker('endDate'))}
                      accessibilityRole="button"
                      accessibilityLabel="Choose end date"
                    >
                      <Icon name="flag" size={15} color={colors.textSecondary} />
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600', flex: 1 }]}>
                        Ends {formatDateFull(endDate)}
                      </Text>
                      <Icon name="chevron-right" size={16} color={colors.textTertiary} />
                    </Pressable>
                  )}
                  {Platform.OS === 'android' && showAndroidEndDate && (
                    <DateTimePicker
                      value={endDateObj}
                      mode="date"
                      display="default"
                      minimumDate={dateObj}
                      onChange={(_e: DateTimePickerEvent, d?: Date) => { setShowAndroidEndDate(false); if (d) setEndDate(localDateKey(d)); }}
                    />
                  )}

                  {hasEndDate && endDate < date ? (
                    <View style={[styles.conflictBox, { backgroundColor: semantic.warningLight, borderColor: semantic.warning }]}>
                      <Icon name="alert-triangle" size={14} color={semantic.warning} />
                      <Text style={[typeScale.caption, { color: colors.textPrimary, flex: 1 }]}>
                        The end date is before the first day.
                      </Text>
                    </View>
                  ) : (
                    <View style={[styles.repeatPreview, { backgroundColor: colors.backgroundTertiary }]}>
                      <Text style={[typeScale.caption, { color: colors.textSecondary, fontWeight: '700' }]}>
                        {upcomingDays.length > 1 ? 'Next days' : 'Only day'}
                      </Text>
                      <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
                        {upcomingDays.map(formatDateShort).join(' · ')}{upcomingDays.length === 4 ? ' …' : ''}
                      </Text>
                      <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                        Workers see their days {describeHorizon(horizonDays)} ahead, and more keep filling in on their own. A day the worker is already on this job is skipped.
                      </Text>
                    </View>
                  )}
                </>
              )}
            </Section>
            ) : null}
          </>
        )}

        {!isMove && (
          <>
            {/* Truck */}
            <Section
              icon="truck"
              title="Truck (optional)"
              accessoryLabel={undefined}
            >
              <Pressable style={styles.fieldRow} onPress={() => setShowTruckSheet(true)} accessibilityRole="button">
                {selectedTruck ? (
                  <>
                    <Icon name="truck" size={15} color={colors.textSecondary} />
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600', flex: 1 }]}>{selectedTruck.name}</Text>
                  </>
                ) : (
                  <Text style={[typeScale.bodyLarge, { color: colors.textTertiary, flex: 1 }]}>No truck assigned</Text>
                )}
                <Icon name="chevron-right" size={16} color={colors.textTertiary} />
              </Pressable>
              {truckConflicts.length > 0 && (
                <View style={[styles.conflictBox, { backgroundColor: semantic.warningLight, borderColor: semantic.warning }]}>
                  <Icon name="alert-triangle" size={14} color={semantic.warning} />
                  <Text style={[typeScale.caption, { color: colors.textPrimary, flex: 1 }]}>
                    {truckConflicts[0].message}
                  </Text>
                </View>
              )}
            </Section>
          </>
        )}

        {/* Instructions */}
        <Section icon="file-text" title="Instructions (optional)">
          <Input
            value={notes}
            onChangeText={setNotes}
            placeholder="Add any notes for the workers..."
            multiline
            numberOfLines={3}
          />
        </Section>

        <Pressable
          onPress={handleCreate}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: pressed ? colors.primaryDark : colors.primary },
          ]}
          accessibilityRole="button"
          accessibilityLabel={isMove ? 'Move Worker' : isRepeating ? 'Schedule Repeating Work' : 'Schedule Work'}
        >
          <Icon name={isRepeating ? 'repeat' : 'calendar'} size={18} color={colors.textOnPrimary} />
          <Text style={[typeScale.labelLarge, { color: colors.textOnPrimary, fontSize: 17 }]}>
            {isMove ? 'Move Worker' : isRepeating ? 'Schedule Repeating Work' : 'Schedule Work'}
          </Text>
        </Pressable>
      </KeyboardAwareScrollView>

      {/* Project picker */}
      {/* iOS date/time picker: opens on the first tap anywhere on the row */}
      {Platform.OS === 'ios' && (
        <BottomSheetModal visible={iosPicker !== null} onRequestClose={() => setIosPicker(null)}>
          <Pressable style={styles.sheetOverlay} onPress={() => setIosPicker(null)}>
            <Pressable style={[styles.pickerCard, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md }]} onPress={(e) => e.stopPropagation()}>
              <View style={styles.pickerHeader}>
                <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
                  {iosPicker === 'date' ? 'Date' : iosPicker === 'endDate' ? 'End Date' : iosPicker === 'start' ? 'Start Time' : 'End Time'}
                </Text>
                <Pressable onPress={() => setIosPicker(null)} hitSlop={12} accessibilityRole="button">
                  <Text style={[typeScale.labelLarge, { color: colors.primary }]}>Done</Text>
                </Pressable>
              </View>
              {iosPicker === 'date' && (
                <DateTimePicker
                  value={dateObj}
                  mode="date"
                  display="inline"
                  accentColor={colors.primary}
                  onChange={(_e: DateTimePickerEvent, d?: Date) => { if (d) setDate(localDateKey(d)); }}
                />
              )}
              {iosPicker === 'endDate' && (
                <DateTimePicker
                  value={endDateObj}
                  mode="date"
                  display="inline"
                  minimumDate={dateObj}
                  accentColor={colors.primary}
                  onChange={(_e: DateTimePickerEvent, d?: Date) => { if (d) setEndDate(localDateKey(d)); }}
                />
              )}
              {(iosPicker === 'start' || iosPicker === 'end') && (
                <DateTimePicker
                  value={iosPicker === 'start' ? startTimeObj : endTimeObj}
                  mode="time"
                  display="spinner"
                  minuteInterval={5}
                  onChange={(_e: DateTimePickerEvent, d?: Date) => {
                    if (!d) return;
                    if (iosPicker === 'start') setStartTime(dateToTimeStr(d));
                    else setEndTime(dateToTimeStr(d));
                  }}
                  style={{ alignSelf: 'center' }}
                />
              )}
            </Pressable>
          </Pressable>
        </BottomSheetModal>
      )}

      <SheetModal visible={showProjectSheet} onClose={() => setShowProjectSheet(false)} title={w('Select Job')}>
        {activeProjects.map(p => (
          <Pressable
            key={p.id}
            style={[styles.sheetRow, p.id === projectId && { backgroundColor: colors.primarySurface }]}
            onPress={() => { setProjectId(p.id); setShowProjectSheet(false); }}
          >
            <View style={[styles.projectIconWrap, { backgroundColor: colors.backgroundTertiary }]}>
              <Icon name="home" size={16} color={colors.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{p.name}</Text>
              {p.address && <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{p.address}</Text>}
            </View>
            {p.id === projectId && <Icon name="check" size={18} color={colors.primary} />}
          </Pressable>
        ))}
      </SheetModal>

      {/* Truck picker */}
      <SheetModal visible={showTruckSheet} onClose={() => setShowTruckSheet(false)} title="Select Truck">
        <Pressable
          style={[styles.sheetRow, !truckId && { backgroundColor: colors.primarySurface }]}
          onPress={() => { setTruckId(''); setShowTruckSheet(false); }}
        >
          <Text style={[typeScale.bodyLarge, { color: colors.textTertiary, flex: 1 }]}>No truck</Text>
          {!truckId && <Icon name="check" size={18} color={colors.primary} />}
        </Pressable>
        {availableTrucks.map(t => (
          <Pressable
            key={t.id}
            style={[styles.sheetRow, t.id === truckId && { backgroundColor: colors.primarySurface }]}
            onPress={() => { setTruckId(t.id); setShowTruckSheet(false); }}
          >
            <Icon name="truck" size={16} color={colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{t.name}</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{t.make} {t.model} · {t.status}</Text>
            </View>
            {t.id === truckId && <Icon name="check" size={18} color={colors.primary} />}
          </Pressable>
        ))}
      </SheetModal>

    </View>
  );
}

function Section({
  icon,
  title,
  required,
  accessoryLabel,
  onPressAccessory,
  children,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  title: string;
  required?: boolean;
  accessoryLabel?: string;
  onPressAccessory?: () => void;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: colors.surface }, shadow.sm]}>
      <View style={styles.sectionHeaderRow}>
        <View style={[styles.sectionIconWrap, { backgroundColor: colors.primarySurface }]}>
          <Icon name={icon} size={15} color={colors.primary} />
        </View>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', flex: 1 }]}>
          {title}{required ? ' *' : ''}
        </Text>
        {accessoryLabel && (
          <Pressable onPress={onPressAccessory} style={styles.sectionAccessory} hitSlop={8}>
            <Text style={[typeScale.bodySmall, { color: colors.primary, fontWeight: '600' }]}>{accessoryLabel}</Text>
            <Icon name="chevron-right" size={13} color={colors.primary} />
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

function SheetModal({
  visible,
  onClose,
  title,
  headerRight,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const body = (
    <>
      <View style={styles.sheetHeaderRow}>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1 }]}>{title}</Text>
        {headerRight ?? (
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
            <Icon name="x" size={22} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>
      <ScrollView bounces={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </>
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
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing['5xl'] },
  titleRow: { flexDirection: 'row' },
  closeButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  section: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionIconWrap: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sectionAccessory: { flexDirection: 'row', alignItems: 'center', gap: 2 },

  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  projectPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'transparent',
  },
  projectIconWrap: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },

  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  pickerCard: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },

  segmentControl: { height: 34 },
  timeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  timeField: { flex: 1, borderRadius: radius.lg, padding: spacing.md },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.full, paddingHorizontal: spacing.xs, height: 34 },
  stepperButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { minWidth: 32, textAlign: 'center' },
  repeatPreview: { borderRadius: radius.lg, padding: spacing.md, gap: 4 },

  workerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  workerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
  },
  addWorkersPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },

  conflictBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderLeftWidth: 2,
  },

  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    borderRadius: radius.full,
    marginTop: spacing.xl,
  },

  sheetIosContainer: { flex: 1, paddingHorizontal: spacing.lg },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: blackAlpha(0.4) },
  sheetCard: {
    maxHeight: '80%',
    paddingHorizontal: spacing.lg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    ...shadow.lg,
  },
  sheetGrabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: spacing.sm },
  sheetHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  workerPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  overridePill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
  },
});
