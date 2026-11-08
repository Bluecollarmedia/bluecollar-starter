import { WorkdayCard } from '@/components/time/WorkdayCard';
import { SkipRequestSheet } from '@/components/time/SkipRequestSheet';
import { withTimedPhoto } from '@/data/timePhotos';
import { loadMySkipRequests, requestSkip, type MySkipRequest } from '@/data/timeTracking';
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Modal, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { Feather } from '@expo/vector-icons';
import { db } from '@/data/store';
import { taskMediaLabel } from '@/components/tasks/TaskMedia';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkerContext } from '@/providers/WorkerProvider';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { isFeatureOn } from '@/config/brand';
import { useCompanyYard } from '@/hooks/useCompanyYard';
import { formatAddress } from '@/lib/address';
import { useResources } from '@/hooks/useResources';
import { WeatherButton } from '@/components/weather/WeatherButton';
import { Avatar } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { JobMap } from '@/components/maps/JobMap';
import { semantic, fixed, whiteAlpha, blackAlpha, withAlpha } from '@/theme/colors';
import { haptics } from '@/lib/haptics';
import type { Assignment } from '@/types/schedule';
import type { ProjectTask } from '@/types/project';
import type { Announcement } from '@/types/announcement';
import type { WeatherActionType } from '@/types/operations';
import { getProjectImageUriById, getWorkerHeaderImageUri } from '@/lib/projectImages';
import { BrandCover } from '@/components/branding/BrandCover';
import { WORKER_HERO_HEIGHT as HERO_HEIGHT } from '@/components/media/HeaderPhotoField';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { useT } from '@/i18n';
import { confirmAction, showMessage } from '@/components/financials/ActionSheet';


const HERO_HEIGHT_COMPACT = 190;
const PILL_OVERHANG = 26;

function formatElapsed(startIso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(startIso).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Directions buttons and the map preview (settings file: features.maps). */
const MAPS_ON = isFeatureOn('maps');

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatTime(time?: string) {
  if (!time) return '';
  const [h, m] = time.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

const WEATHER_ACTION_META: Record<WeatherActionType, { label: string; icon: string }> = {
  weather_warning: { label: 'Weather Warning', icon: 'cloud' },
  delayed_start: { label: 'Delayed Start', icon: 'clock' },
  no_work: { label: 'No Work Today', icon: 'x-circle' },
  early_finish: { label: 'Early Finish', icon: 'sunset' },
  project_cancel: { label: 'Job Cancelled', icon: 'x-circle' },
};

function minutesUntil(time: string): number {
  const [h, m] = time.split(':').map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 60000);
}

/**
 * Today for a worker on project jobs. With the time clock installed, a worker who is not clocked in sees only a Clock In button
 * (never the work); once a day is running the clock disappears and the job screen is shown.
 */
export default function WorkerTodayScreen() {
  const t = useT();
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const { resources } = useResources();
  const {
    todayAssignments, currentJob, jobState, checkIns, checkOuts, moveToNextJob,
    scheduleConfirmed, confirmSchedule, checkIn, checkOut, locateForCheckIn, locateForCheckOut, openMapsNavigation,
    timeOn, checkInTimed, checkOutTimed, workday,
    projectTasks, projectSettings, taskPhotoCaptured, isTaskLead,
  } = useWorkerContext();

  // The job on screen: the one in progress, else the next unfinished one, else the last one
  // (so a worker who checked out by mistake can check back in).
  const primaryAssignment = currentJob
    ?? todayAssignments.find(a => a.status !== 'completed')
    ?? todayAssignments[todayAssignments.length - 1];
  const isCheckedIn = jobState === 'checked_in' || jobState === 'working';
  const showWorking = isCheckedIn && !!primaryAssignment;
  const showConfirmed = scheduleConfirmed && !!primaryAssignment && !isCheckedIn;
  const showCheckedOut = jobState === 'completed' && !!primaryAssignment;

  // The company yard: its own destination, never the jobsite.
  const { yard, label: yardName } = useCompanyYard();

  const { getUnreadForWorker, markAnnouncementRead } = useAnnouncements();
  const unreadAnnouncement: Announcement | null = user ? getUnreadForWorker(user.id) : null;
  const [openAnnouncement, setOpenAnnouncement] = useState(false);

  const [showCheckoutConfirm, setShowCheckoutConfirm] = useState(false);
  const [tick, setTick] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTick(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const now = new Date();
  const greeting = now.getHours() < 12 ? t('Good morning') : now.getHours() < 17 ? t('Good afternoon') : t('Good evening');
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const tagline = showConfirmed ? t("You're all set for today.") : t("Let's get it done today.");

  const lastCheckIn = primaryAssignment
    ? [...checkIns].reverse().find(c => c.assignmentId === primaryAssignment.id)
    : undefined;
  const lastCheckOut = primaryAssignment
    ? [...checkOuts].reverse().find(c => c.assignmentId === primaryAssignment.id)
    : undefined;

  const tasks = primaryAssignment ? projectTasks(primaryAssignment.projectId) : [];
  const isLead = primaryAssignment ? isTaskLead(primaryAssignment.projectId) : false;
  const leadId = primaryAssignment ? db.projects.find(p => p.id === primaryAssignment.projectId)?.taskLeadId : undefined;
  const lead = leadId ? db.people[leadId] : undefined;
  const completedTasks = tasks.filter(task => task.status === 'completed');
  // Completed tasks fold away under a toggle so the list shows only what's left to do.
  const openTasks = tasks.filter(task => task.status !== 'completed');
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);
  const settings = primaryAssignment ? projectSettings(primaryAssignment.projectId) : undefined;
  const photoRequired = settings?.completionPhotoRequired ?? false;

  function handleConfirm() {
    haptics.success();
    confirmSchedule();
  }

  const [locating, setLocating] = useState(false);

  // Asking to skip a job: a request the owner decides. Nothing is skipped (and the day's order stays locked) until they approve.
  const [skips, setSkips] = useState<MySkipRequest[]>([]);
  const [skipOpen, setSkipOpen] = useState(false);
  useEffect(() => {
    if (!timeOn) return;
    let live = true;
    loadMySkipRequests().then((r) => { if (live && r.ok) setSkips(r.data); });
    return () => { live = false; };
  }, [timeOn, primaryAssignment?.id]);
  const pendingSkip = primaryAssignment ? skips.find((s) => s.refId === primaryAssignment.id && s.status === 'pending') : undefined;
  async function sendSkip(reason: string) {
    if (!primaryAssignment) return;
    const r = await requestSkip('assignment', primaryAssignment.id, reason);
    if (!r.ok) { showMessage(t("Couldn't send the request"), r.error); return; }
    haptics.success();
    setSkipOpen(false);
    const again = await loadMySkipRequests();
    if (again.ok) setSkips(again.data);
  }
  const needsClockIn = timeOn && !workday.active;

  async function handleCheckIn() {
    if (locating) return;
    haptics.select();
    setLocating(true);
    const result = await locateForCheckIn(primaryAssignment?.id);
    setLocating(false);
    if (!result.ok) {
      haptics.warning();
      if (Platform.OS !== 'web' && result.openSettings) {
        confirmAction(result.title, result.message, t('Open Settings'), () => { void Linking.openSettings(); });
      } else {
        showMessage(result.title, result.message);
      }
      return;
    }
    if (timeOn) {
      // The workday is running: the database checks the clock-in, job order and photo rule, then records the property time.
      const started = primaryAssignment
        ? await withTimedPhoto(() => checkInTimed(result.gps, primaryAssignment.id), 'start', { kind: 'project', projectId: primaryAssignment.projectId, assignmentId: primaryAssignment.id })
        : await checkInTimed(result.gps, undefined);
      if (!started.ok) {
        haptics.warning();
        showMessage(t("Can't start at this job site"), started.error);
        return;
      }
      haptics.success();
      // "I'm here" is the confirmation: there is no separate Confirm Schedule step (it also clears the owner's "hasn't confirmed" alert).
      confirmSchedule();
      return;
    }
    haptics.success();
    checkIn(result.gps, primaryAssignment?.id);
    confirmSchedule();
  }

  function handleCheckOutPress() {
    haptics.select();
    setShowCheckoutConfirm(true);
  }

  async function confirmCheckOut() {
    setShowCheckoutConfirm(false);
    haptics.success();
    // Location is recorded for the owner's records; it never blocks checking out.
    const where = await locateForCheckOut();
    if (timeOn) {
      const done = primaryAssignment
        ? await withTimedPhoto(() => checkOutTimed(where), 'complete', { kind: 'project', projectId: primaryAssignment.projectId, assignmentId: primaryAssignment.id })
        : await checkOutTimed(where);
      if (!done.ok) {
        haptics.warning();
        showMessage(t("Can't finish at this job site"), done.error);
      }
      return;
    }
    checkOut(where);
  }

  function handleBackToToday() {
    haptics.select();
    moveToNextJob();
  }

  function handleTaskPress(task: ProjectTask) {
    router.push(`/(worker)/task/${task.id}` as any);
  }

  function renderTaskRow(task: ProjectTask, first: boolean) {
    return (
      <Pressable
        key={task.id}
        style={[
          styles.taskRow,
          { borderTopColor: colors.borderLight, marginTop: first ? spacing.md : 0 },
        ]}
        onPress={() => handleTaskPress(task)}
      >
        {task.status === 'completed' ? (
          <Feather name="check-circle" size={22} color={colors.success} />
        ) : (
          <Feather name="circle" size={22} color={colors.border} />
        )}
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text
            style={[
              typeScale.bodyLarge,
              { color: task.status === 'completed' ? colors.textSecondary : colors.textPrimary },
              task.status === 'completed' && { textDecorationLine: 'line-through' },
            ]}
          >
            {task.title}
          </Text>
          {(db.taskAttachments[task.id]?.length ?? 0) > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              <Feather name="paperclip" size={12} color={colors.primaryOnWhite} />
              <Text style={[typeScale.caption, { color: colors.primaryOnWhite, marginLeft: 4 }]}>
                {taskMediaLabel(db.taskAttachments[task.id])}
              </Text>
            </View>
          )}
          {task.status === 'completed' && task.completer && (
            <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
              {t('Done by {name}', { name: `${task.completer.firstName} ${task.completer.lastName}` })}
            </Text>
          )}
          {task.status === 'in_progress' && (
            <View style={[styles.inProgressTag, { backgroundColor: colors.warningLight }]}>
              <Text style={[typeScale.caption, { color: colors.warning }]}>{t('In Progress')}</Text>
            </View>
          )}
        </View>
        {photoRequired && task.status !== 'completed' && !taskPhotoCaptured[task.id] && (
          <Feather name="camera" size={17} color={colors.info} style={{ marginRight: spacing.sm }} />
        )}
        <Feather name="chevron-right" size={18} color={colors.textTertiary} />
      </Pressable>
    );
  }

  function handleYardPress() {
    if (!yard) return;
    haptics.select();
    openMapsNavigation(yard);
  }

  function handleOpenAnnouncement() {
    haptics.select();
    setOpenAnnouncement(true);
  }

  function handleCloseAnnouncement() {
    setOpenAnnouncement(false);
    if (user && unreadAnnouncement) {
      markAnnouncementRead(unreadAnnouncement.id, user.id);
    }
  }

  if (showCheckedOut && primaryAssignment) {
    const workedLabel = lastCheckIn && lastCheckOut
      ? formatElapsed(lastCheckIn.timestamp, new Date(lastCheckOut.timestamp))
      : lastCheckIn ? formatElapsed(lastCheckIn.timestamp, tick) : '—';

    return (
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={[styles.checkedOutScreen, { flexGrow: 1, paddingTop: insets.top + spacing['3xl'], paddingBottom: tabBarClearance }]}
      >
        <View style={[styles.checkedOutIcon, { backgroundColor: colors.success }]}>
          <Feather name="check" size={40} color={fixed.white} />
        </View>
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginTop: spacing.xl }]}>
          {t('Job Complete')}
        </Text>
        <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center', paddingHorizontal: spacing.lg }]}>
          {timeOn ? t('Great work! Clock out for the day on the Clock tab when you are done.') : t('Great work!')}
        </Text>

        <View style={[styles.card, styles.summaryCard, { backgroundColor: colors.surface }, shadow.md]}>
          <View style={styles.labelRow}>
            <View style={[styles.jobIcon, { backgroundColor: colors.primarySurface }]}>
              <Feather name="home" size={14} color={colors.primaryDark} />
            </View>
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary, marginLeft: spacing.sm }]}>
              {primaryAssignment.project?.name ?? t('Unknown Job')}
            </Text>
          </View>
          {primaryAssignment.project?.address && (
            <View style={[styles.metaRow, { marginLeft: 36 }]}>
              <Feather name="map-pin" size={13} color={colors.textTertiary} />
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
                {primaryAssignment.project.address}
              </Text>
            </View>
          )}

          <View style={[styles.summaryDivider, { backgroundColor: colors.borderLight }]} />

          <View style={styles.summaryRow}>
            <View style={styles.labelRow}>
              <Feather name="clock" size={14} color={colors.textTertiary} />
              <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginLeft: spacing.xs }]}>{t('Worked')}</Text>
            </View>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{workedLabel}</Text>
          </View>
          <View style={styles.summaryRow}>
            <View style={styles.labelRow}>
              <Feather name="check-square" size={14} color={colors.textTertiary} />
              <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginLeft: spacing.xs }]}>{t('Tasks Completed')}</Text>
            </View>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
              {t('{done} of {total}', { done: completedTasks.length, total: tasks.length })}
            </Text>
          </View>
        </View>

        <View style={{ width: '100%', marginTop: spacing.lg }}><WorkdayCard gate /></View>

        <Pressable onPress={handleBackToToday} style={{ width: '100%' }}>
          <LinearGradient
            colors={[colors.primary, colors.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.pillButton}
          >
            <Feather name="home" size={18} color={colors.textOnPrimary} />
            <Text style={[typeScale.labelLarge, { color: colors.textOnPrimary, marginLeft: spacing.sm }]}>
              {t('Back to Today')}
            </Text>
          </LinearGradient>
        </Pressable>
        <Pressable onPress={handleCheckIn} hitSlop={8} style={{ marginTop: spacing.lg }} accessibilityRole="button">
          <Text style={[typeScale.labelLarge, { color: colors.primaryOnWhite }]}>{locating ? t('Finding your location…') : t('Left by mistake? Check back in')}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: tabBarClearance }}>
        <View style={[styles.hero, { height: showWorking ? HERO_HEIGHT_COMPACT : HERO_HEIGHT }]}>
          {/* The header is always the picture the owner set for workers in Settings, never a project's photo. */}
          <BrandCover uri={getWorkerHeaderImageUri()} style={styles.heroImage} />
          <LinearGradient
            colors={['transparent', 'transparent', colors.groupedBackground]}
            locations={[0, 0.78, 1]}
            style={StyleSheet.absoluteFill}
          />

          <View style={[styles.weatherWrap, { top: insets.top + spacing.sm }]}>
            <WeatherButton to="/(worker)/weather" />
          </View>
          <View style={[styles.avatarWrap, { top: insets.top + spacing.sm }]}>
            <Avatar firstName={user?.firstName ?? ''} lastName={user?.lastName ?? ''} size={44} uri={user?.avatarUrl} />
          </View>

          {showWorking ? (
            <View style={[styles.onSitePill, { top: insets.top + spacing.sm, backgroundColor: whiteAlpha(0.9) }]}>
              <View style={[styles.onSiteDot, { backgroundColor: colors.success }]} />
              <Text style={[typeScale.labelSmall, { color: colors.textPrimary, marginLeft: spacing.xs }]}>{t('On Site')}</Text>
            </View>
          ) : (
            <View style={styles.heroText}>
              <Text style={[typeScale.bodyMedium, styles.heroTextShadow, { color: fixed.white }]}>{dateStr}</Text>
              <Text style={[typeScale.displayLarge, styles.heroTextShadow, { color: fixed.white, marginTop: 2 }]}>
                {greeting},{'\n'}{user?.firstName ?? t('there')}
              </Text>
              {yard && MAPS_ON && (
                <Pressable
                  onPress={handleYardPress}
                  hitSlop={{ top: 8, bottom: 8 }}
                  style={({ pressed }) => [styles.yardRow, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${yardName}, ${formatAddress(yard)}`}
                  accessibilityHint={t('Opens directions to the yard')}
                >
                  <View style={[styles.yardPin, { backgroundColor: colors.primary }]}>
                    <Feather name="map-pin" size={11} color={colors.textOnPrimary} />
                  </View>
                  <Text
                    style={[typeScale.labelLarge, styles.heroTextShadow, styles.yardText]}
                    numberOfLines={1}
                  >
                    {yardName} · {yard.address}
                  </Text>
                  <Feather name="chevron-right" size={16} color={whiteAlpha(0.85)} />
                </Pressable>
              )}
              <Text style={[typeScale.bodyLarge, styles.heroTextShadow, { color: fixed.white, marginTop: spacing.xs }]}>
                {tagline}
              </Text>
            </View>
          )}

          {!showWorking && primaryAssignment?.truck && (
            <Pressable
              style={[styles.truckPill, { backgroundColor: colors.primarySurface, bottom: -PILL_OVERHANG }, shadow.md]}
              // Opens this truck's codes when the owner has shared any with this worker.
              onPress={resources.some((r) => r.truckId === primaryAssignment.truck!.id)
                ? () => router.push(`/(worker)/my-resources?truckId=${primaryAssignment.truck!.id}` as any)
                : undefined}
            >
              <Feather name="truck" size={18} color={colors.primaryDark} />
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1, marginLeft: spacing.sm, fontWeight: '600' }]}>
                {primaryAssignment.truck.name}
              </Text>
              <Feather name="chevron-right" size={18} color={colors.primaryDark} />
            </Pressable>
          )}
        </View>

        <View style={[styles.content, { paddingTop: showWorking ? spacing.xl : PILL_OVERHANG + spacing.xl }]}>
          <WorkdayCard gate />
          {unreadAnnouncement && (() => {
            const weatherMeta = unreadAnnouncement.weatherAction ? WEATHER_ACTION_META[unreadAnnouncement.weatherAction] : null;
            const isStrong = unreadAnnouncement.priority === 'urgent' || !!weatherMeta;
            return (
              <Pressable
                onPress={handleOpenAnnouncement}
                style={[
                  styles.card,
                  styles.announcementCard,
                  isStrong
                    ? { backgroundColor: colors.errorLight, borderWidth: 1, borderColor: colors.error }
                    : { backgroundColor: colors.surface },
                  shadow.md,
                ]}
              >
                <View style={[styles.announcementIcon, { backgroundColor: isStrong ? colors.error : colors.primarySurface }]}>
                  <Feather name={(weatherMeta?.icon ?? 'volume-2') as any} size={16} color={isStrong ? fixed.white : colors.primaryDark} />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <View style={styles.announcementTopRow}>
                    <Text style={[typeScale.labelSmall, { color: isStrong ? colors.error : colors.textSecondary, fontWeight: '700' }]}>
                      {weatherMeta ? t(weatherMeta.label).toUpperCase() : unreadAnnouncement.priority === 'urgent' ? t('URGENT') : t('ANNOUNCEMENT')}
                    </Text>
                  </View>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', marginTop: 2 }]} numberOfLines={1}>
                    {unreadAnnouncement.title}
                  </Text>
                  <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]} numberOfLines={2}>
                    {unreadAnnouncement.body}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={isStrong ? colors.error : colors.textTertiary} />
              </Pressable>
            );
          })()}

          {!scheduleConfirmed && todayAssignments.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.surface }, shadow.md]}>
              <Feather name="check-square" size={26} color={colors.primaryOnWhite} />
              <Text style={[typeScale.headingLarge, { color: colors.textPrimary, marginTop: spacing.md }]}>
                {t('Confirm Your Schedule')}
              </Text>
              <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                {todayAssignments.length > 1
                  ? t("You have {n} jobs today. Confirm to let the team know you're ready.", { n: todayAssignments.length })
                  : t("You have 1 job today. Confirm to let the team know you're ready.")}
              </Text>
              <Pressable onPress={handleConfirm} style={{ marginTop: spacing.lg }}>
                <LinearGradient
                  colors={[colors.primary, colors.primary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.pillButton}
                >
                  <Feather name="check" size={18} color={colors.textOnPrimary} />
                  <Text style={[typeScale.labelLarge, { color: colors.textOnPrimary, marginLeft: spacing.sm }]}>
                    {t('Confirm Schedule')}
                  </Text>
                </LinearGradient>
              </Pressable>
            </View>
          )}

          {!scheduleConfirmed && primaryAssignment && (
            <JobCard label={t("Today's Job")} assignment={primaryAssignment} />
          )}

          {showConfirmed && primaryAssignment && (
            <>
              <View style={[styles.card, styles.mapCard, { backgroundColor: colors.surface }, shadow.md]}>
                <JobCardBody label={t('Next Job')} assignment={primaryAssignment} />

                {MAPS_ON && primaryAssignment.project?.address && (
                  <>
                    <Pressable onPress={() => openMapsNavigation(primaryAssignment.project!)} accessibilityLabel={t('Open in Maps')}>
                      <JobMap place={primaryAssignment.project} />
                    </Pressable>
                    <Pressable
                      style={styles.openMapsRow}
                      onPress={() => openMapsNavigation(primaryAssignment.project!)}
                    >
                      <Feather name="navigation" size={15} color={colors.primaryOnWhite} />
                      <Text style={[typeScale.bodyMedium, { color: colors.primaryOnWhite, flex: 1, marginLeft: spacing.sm, fontWeight: '600' }]}>
                        {t('Open in Maps')}
                      </Text>
                      <Feather name="chevron-right" size={16} color={colors.textTertiary} />
                    </Pressable>
                  </>
                )}
              </View>

              {primaryAssignment.startTime && (
                <View style={styles.countdownRow}>
                  <Feather name="clock" size={14} color={colors.textSecondary} />
                  <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
                    {(() => {
                      const mins = minutesUntil(primaryAssignment.startTime!);
                      if (mins > 1) return t('Starts in {n} minutes', { n: mins });
                      if (mins === 1) return t('Starts in 1 minute');
                      return t('Starting now');
                    })()}
                  </Text>
                </View>
              )}

              {needsClockIn ? (
                <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, textAlign: 'center' }]}>{t('Clock in first on the Clock tab.')}</Text>
              ) : (
              <Pressable onPress={handleCheckIn}>
                <LinearGradient
                  colors={[colors.primary, colors.primary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.pillButton, styles.checkInButton]}
                >
                  <View style={styles.checkInRow}>
                    <Feather name="log-in" size={20} color={colors.textOnPrimary} />
                    <Text style={[typeScale.headingSmall, { color: colors.textOnPrimary, marginLeft: spacing.sm, fontWeight: '700' }]}>
                      {timeOn ? t('START AT JOB SITE') : t("I'M HERE")}
                    </Text>
                  </View>
                  <Text style={[typeScale.bodySmall, { color: withAlpha(colors.textOnPrimary, 0.85), marginTop: 2 }]}>
                    {locating ? t('Finding your location…') : timeOn ? t('Start your time at this job site') : t('Check in to start this job')}
                  </Text>
                </LinearGradient>
              </Pressable>
              )}
              {timeOn && primaryAssignment ? (
                pendingSkip ? (
                  <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center' }]}>{t('Skip requested. Waiting for the owner. This job stays open until they approve it.')}</Text>
                ) : (
                  <Pressable onPress={() => setSkipOpen(true)} hitSlop={8} accessibilityRole="button">
                    <Text style={[typeScale.labelLarge, { color: colors.textSecondary, textAlign: 'center' }]}>{t("Can't do this job? Ask to skip it")}</Text>
                  </Pressable>
                )
              ) : null}
            </>
          )}

          {showWorking && primaryAssignment && (
            <>
              <View>
                <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>
                  {primaryAssignment.project?.name ?? t('Unknown Job')}
                </Text>
                {primaryAssignment.project?.address && (
                  <View style={[styles.metaRow, { marginTop: spacing.xs }]}>
                    <Feather name="map-pin" size={13} color={colors.textTertiary} />
                    <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
                      {primaryAssignment.project.address}
                    </Text>
                  </View>
                )}
                <View style={styles.metaRow}>
                  <Feather name="clock" size={13} color={colors.textTertiary} />
                  <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
                    {primaryAssignment.isFullDay ? t('Full day') : `${formatTime(primaryAssignment.startTime)} – ${formatTime(primaryAssignment.endTime)}`}
                  </Text>
                </View>
              </View>

              <View style={[styles.card, styles.statCard, { backgroundColor: colors.surface }, shadow.md]}>
                <View style={styles.statCol}>
                  <View style={styles.labelRow}>
                    <Feather name="check-circle" size={13} color={colors.success} />
                    <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.xs, fontWeight: '600' }]}>
                      {t('Checked In')}
                    </Text>
                  </View>
                  <Text style={[typeScale.headingLarge, { color: colors.textPrimary, marginTop: spacing.xs }]}>
                    {lastCheckIn ? formatClock(lastCheckIn.timestamp) : '—'}
                  </Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.borderLight }]} />
                <View style={styles.statCol}>
                  <View style={styles.labelRow}>
                    <Feather name="clock" size={13} color={colors.primaryOnWhite} />
                    <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.xs, fontWeight: '600' }]}>
                      {t('On site for')}
                    </Text>
                  </View>
                  <Text style={[typeScale.headingLarge, { color: colors.textPrimary, marginTop: spacing.xs }]}>
                    {lastCheckIn ? formatElapsed(lastCheckIn.timestamp, tick) : '—'}
                  </Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                {MAPS_ON && primaryAssignment.project?.address && (
                  <Pressable
                    style={[styles.actionPill, { backgroundColor: colors.primarySurface }]}
                    onPress={() => openMapsNavigation(primaryAssignment.project!)}
                  >
                    <Feather name="navigation" size={16} color={colors.primaryDark} />
                    <Text style={[typeScale.bodyMedium, { color: colors.primaryDark, marginLeft: spacing.xs, fontWeight: '600' }]}>
                      {t('Open in Maps')}
                    </Text>
                  </Pressable>
                )}
              </View>

              {tasks.length > 0 && (
                <View style={[styles.card, styles.mapCard, { backgroundColor: colors.surface }, shadow.md]}>
                  <View style={styles.tasksHeader}>
                    <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>{t("Today's Tasks")}</Text>
                    <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
                      {t('{done} of {total} completed', { done: completedTasks.length, total: tasks.length })}
                    </Text>
                  </View>
                  <View style={{ paddingHorizontal: spacing.lg }}>
                    <View style={[styles.progressTrack, { backgroundColor: colors.borderLight }]}>
                      <View
                        style={[
                          styles.progressFill,
                          { backgroundColor: colors.primary, width: `${tasks.length > 0 ? (completedTasks.length / tasks.length) * 100 : 0}%` },
                        ]}
                      />
                    </View>
                    <View style={[styles.leadRow, { marginTop: spacing.sm }]}>
                      <Feather name={isLead ? 'award' : 'lock'} size={13} color={isLead ? colors.primaryOnWhite : colors.textTertiary} />
                      <Text style={[typeScale.caption, { color: isLead ? colors.primaryOnWhite : colors.textSecondary, marginLeft: 6, flex: 1 }]}>
                        {isLead
                          ? t("You're the Task Lead. You check off tasks for this job.")
                          : lead
                          ? t('Task Lead: {name}. Only they can check off tasks.', { name: `${lead.firstName} ${lead.lastName}`.trimEnd() })
                          : t('No Task Lead yet. The owner needs to pick one before tasks can be checked off.')}
                      </Text>
                    </View>
                  </View>
                  {openTasks.map((task, i) => renderTaskRow(task, i === 0))}
                  {openTasks.length === 0 && (
                    <View style={[styles.allDoneRow, { marginTop: spacing.md }]}>
                      <Feather name="check-circle" size={18} color={colors.success} />
                      <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginLeft: spacing.sm }]}>
                        {t('All tasks done')}
                      </Text>
                    </View>
                  )}
                  {completedTasks.length > 0 && (
                    <Pressable
                      style={[styles.completedToggle, { borderTopColor: colors.borderLight }]}
                      onPress={() => { haptics.select(); setShowCompletedTasks(v => !v); }}
                    >
                      <Text style={[typeScale.bodyLarge, { color: colors.primaryOnWhite, fontWeight: '600', flex: 1 }]}>
                        {showCompletedTasks ? t('Hide completed') : t('Show completed ({n})', { n: completedTasks.length })}
                      </Text>
                      <Feather name={showCompletedTasks ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primaryOnWhite} />
                    </Pressable>
                  )}
                  {showCompletedTasks && completedTasks.map(task => renderTaskRow(task, false))}
                </View>
              )}

              {primaryAssignment.notes && (
                <View style={[styles.card, { backgroundColor: colors.surface }, shadow.md]}>
                  <View style={styles.labelRow}>
                    <Feather name="file-text" size={15} color={colors.primaryOnWhite} />
                    <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.xs, fontWeight: '600' }]}>
                      {t('Job Notes')}
                    </Text>
                  </View>
                  <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, marginTop: spacing.xs }]}>
                    {primaryAssignment.notes}
                  </Text>
                </View>
              )}

              <Pressable onPress={handleCheckOutPress}>
                <LinearGradient
                  colors={[colors.primary, colors.primaryPressed]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.card, styles.leavingCard, { borderRadius: 28 }]}
                >
                  <Feather name="check-circle" size={22} color={colors.textOnPrimary} />
                  <View style={{ marginLeft: spacing.md, flex: 1 }}>
                    <Text style={[typeScale.headingSmall, { color: colors.textOnPrimary, fontWeight: '700' }]}>
                      {t('COMPLETE JOB')}
                    </Text>
                    <Text style={[typeScale.bodySmall, { color: withAlpha(colors.textOnPrimary, 0.85) }]}>
                      {timeOn ? t('Finish this job. You clock out for the day on the Clock tab.') : t('Finish this job.')}
                    </Text>
                  </View>
                </LinearGradient>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={showCheckoutConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCheckoutConfirm(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowCheckoutConfirm(false)}
        >
          <Pressable style={[styles.modalCard, { backgroundColor: colors.surfaceElevated }]} onPress={() => {}}>
            <View style={[styles.modalIcon, { backgroundColor: colors.primarySurface }]}>
              <Feather name="check-circle" size={24} color={colors.primaryOnWhite} />
            </View>
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary, marginTop: spacing.lg, textAlign: 'center' }]}>
              {t('Complete this job?')}
            </Text>
            <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }]}>
              {timeOn
                ? t('This marks {name} finished. You stay clocked in until you clock out for the day on the Clock tab.', { name: primaryAssignment?.project?.name ?? t('this job') })
                : t('This marks {name} finished.', { name: primaryAssignment?.project?.name ?? t('this job') })}
            </Text>

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => setShowCheckoutConfirm(false)}
              >
                <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{t('Cancel')}</Text>
              </Pressable>
              <Pressable style={styles.modalButton} onPress={confirmCheckOut}>
                <LinearGradient
                  colors={[colors.primary, colors.primaryPressed]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.modalButtonFill}
                >
                  <Text style={[typeScale.labelLarge, { color: colors.textOnPrimary }]}>{t('Complete job')}</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <BottomSheetModal visible={openAnnouncement} onRequestClose={handleCloseAnnouncement}>
        <Pressable style={styles.sheetBackdrop} onPress={handleCloseAnnouncement}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surfaceElevated, paddingBottom: insets.bottom + spacing.lg }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.borderLight }]} />
            {unreadAnnouncement && (() => {
              const weatherMeta = unreadAnnouncement.weatherAction ? WEATHER_ACTION_META[unreadAnnouncement.weatherAction] : null;
              const isStrong = unreadAnnouncement.priority === 'urgent' || !!weatherMeta;
              return (
                <>
                  {isStrong && (
                    <View style={[styles.sheetBadge, { backgroundColor: colors.errorLight }]}>
                      <Feather name={(weatherMeta?.icon ?? 'alert-circle') as any} size={13} color={colors.error} />
                      <Text style={[typeScale.labelSmall, { color: colors.error, fontWeight: '700', marginLeft: 4 }]}>
                        {weatherMeta ? t(weatherMeta.label).toUpperCase() : t('URGENT')}
                      </Text>
                    </View>
                  )}
                  <Text style={[typeScale.headingLarge, { color: colors.textPrimary, marginTop: spacing.sm }]}>
                    {unreadAnnouncement.title}
                  </Text>
                  <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.xs }]}>
                    {unreadAnnouncement.author?.firstName} {unreadAnnouncement.author?.lastName}
                  </Text>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginTop: spacing.md, lineHeight: 22 }]}>
                    {unreadAnnouncement.body}
                  </Text>
                  <Pressable
                    style={[styles.pillButton, { backgroundColor: colors.primary, marginTop: spacing.xl }]}
                    onPress={handleCloseAnnouncement}
                  >
                    <Text style={[typeScale.labelLarge, { color: colors.textOnPrimary, fontWeight: '700' }]}>{t('Got it')}</Text>
                  </Pressable>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </BottomSheetModal>
      <SkipRequestSheet visible={skipOpen} propertyName={primaryAssignment?.project?.name} onClose={() => setSkipOpen(false)} onSend={sendSkip} />
    </View>
  );
}

function JobCard({ label, assignment }: { label: string; assignment: Assignment }) {
  const { colors } = useTheme();
  return (
    <Pressable style={[styles.card, styles.mapCard, { backgroundColor: colors.surface }, shadow.md]}>
      <JobCardBody label={label} assignment={assignment} />
    </Pressable>
  );
}

function JobCardBody({ label, assignment }: { label: string; assignment: Assignment }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View style={styles.jobCard}>
      <View style={{ flex: 1 }}>
        <View style={styles.labelRow}>
          <Feather name="calendar" size={13} color={colors.primaryOnWhite} />
          <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.xs, fontWeight: '600' }]}>
            {label}
          </Text>
        </View>

        <View style={[styles.labelRow, { marginTop: spacing.sm }]}>
          <View style={[styles.jobIcon, { backgroundColor: colors.primarySurface }]}>
            <Feather name="home" size={14} color={colors.primaryDark} />
          </View>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary, marginLeft: spacing.sm }]}>
            {assignment.project?.name ?? t('Unknown Job')}
          </Text>
        </View>

        {assignment.project?.address && (
          <View style={[styles.metaRow, { marginLeft: 36 }]}>
            <Feather name="map-pin" size={13} color={colors.textTertiary} />
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
              {assignment.project.address}
            </Text>
          </View>
        )}
        <View style={[styles.metaRow, { marginLeft: 36 }]}>
          <Feather name="clock" size={13} color={colors.textTertiary} />
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
            {assignment.isFullDay ? t('Full day') : `${formatTime(assignment.startTime)} – ${formatTime(assignment.endTime)}`}
          </Text>
        </View>
      </View>
      <Feather name="chevron-right" size={20} color={colors.textTertiary} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: { height: HERO_HEIGHT, width: '100%' },
  heroImage: { width: '100%', height: '100%' },
  avatarWrap: { position: 'absolute', right: spacing.lg },
  weatherWrap: { position: 'absolute', right: spacing.lg + 44 + spacing.sm },
  heroText: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: 100 },
  yardRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', marginTop: spacing.sm, minHeight: 28 },
  yardPin: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  yardText: { color: fixed.white, flexShrink: 1, marginRight: spacing.xs },
  heroTextShadow: {
    textShadowColor: blackAlpha(0.35),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  truckPill: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.full,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  card: { borderRadius: radius.xl, padding: spacing.lg },
  pillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: radius.full,
  },
  jobCard: { flexDirection: 'row', alignItems: 'flex-start', padding: spacing.lg },
  labelRow: { flexDirection: 'row', alignItems: 'center' },
  jobIcon: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  mapCard: { padding: 0, overflow: 'hidden' },
  openMapsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkInButton: { height: 72, flexDirection: 'column' },
  checkInRow: { flexDirection: 'row', alignItems: 'center' },
  onSitePill: {
    position: 'absolute',
    left: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  onSiteDot: { width: 7, height: 7, borderRadius: 4 },
  statCard: { flexDirection: 'row', alignItems: 'center' },
  statCol: { flex: 1 },
  statDivider: { width: 1, height: 40, marginHorizontal: spacing.lg },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.full,
  },
  leadRow: { flexDirection: 'row', alignItems: 'center' },
  tasksHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  progressTrack: {
    height: 5,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  progressFill: { height: 5, borderRadius: radius.full },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inProgressTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.xs,
    marginTop: 4,
  },
  leavingCard: { flexDirection: 'row', alignItems: 'center' },
  allDoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  completedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  checkedOutScreen: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  checkedOutIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCard: { width: '100%' },
  summaryDivider: { height: 1, marginVertical: spacing.md },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: blackAlpha(0.5),
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
  },
  modalIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    height: 48,
    borderRadius: radius.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonFill: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  announcementCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  announcementIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  announcementTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sheetBackdrop: { flex: 1, backgroundColor: blackAlpha(0.4), justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
});
