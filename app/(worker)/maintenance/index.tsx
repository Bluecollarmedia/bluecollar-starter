import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, Platform, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WeatherButton } from '@/components/weather/WeatherButton';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { ServiceIcon } from '@/components/maintenance/ServiceIcon';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkerContext } from '@/providers/WorkerProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { useMaintenanceCheckIn } from '@/hooks/useMaintenanceCheckIn';
import { useMyMaintenanceRoute } from '@/hooks/useMaintenance';
import { useDb, db } from '@/data/store';
import { locationLabel } from '@/data/maintenance';
import { missingRequirements, finishStopAndAdvance, useFinishingStop } from '@/data/maintenanceFinish';
import { haptics } from '@/lib/haptics';
import { useT } from '@/i18n';
import { crewStopMessage, isCrewLeader } from '@/lib/maintenanceLeader';
import { EmptyState } from '@/components/ui';
import { BrandCover } from '@/components/branding/BrandCover';
import { JobMap } from '@/components/maps/JobMap';
import { YardStartCard } from '@/components/maintenance/YardStartCard';
import { WorkdayCard } from '@/components/time/WorkdayCard';
import { WorkerToday } from '@/components/today/WorkerToday';
import { CrewClockOutCard } from '@/components/maintenance/CrewClockOutCard';
import { OtherWorkCard } from '@/components/worker/OtherWorkCard';
import { useWorkerLanding } from '@/hooks/useWorkerLanding';
import { RouteProgress } from '@/components/maintenance/RouteProgress';
import { StopRow, StopStatusPill } from '@/components/maintenance/StopRow';
import { displayStatus } from '@/components/maintenance/types';
import { formatClock, servicesLabel, stopAddress } from '@/components/maintenance/format';
import { getWorkerHeaderImageUri } from '@/lib/projectImages';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import type { MaintenanceStopDetail } from '@/types/maintenance';

const HERO_HEIGHT = 210;
/** The white sheet's rounded top edge overlaps the photo by this much. */
const SHEET_RADIUS = 28;
/** Room the fixed action button takes at the bottom of the scroll. */
const ACTION_AREA = 96;

function showMessage(title: string, message: string) {
  if (Platform.OS === 'web') alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

function firstName(personId?: string): string | undefined {
  return personId ? db.people[personId]?.firstName : undefined;
}

/**
 * Maintenance worker home: today's route first. The crew shares one route,
 * so every member sees the same order, instructions and progress. The single
 * button at the bottom follows the day: Start Day, then I'm Here and Finish
 * Stop for each stop in the owner's order.
 */
function LegacyMaintenanceToday() {
  const t = useT();
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  // The action button is pinned to the bottom of the WINDOW, not of this screen's container: native tabs sometimes
  // shrink the container to end above the tab bar, which used to leave the button floating too high. We measure how far
  // the container's bottom edge sits above the window bottom and subtract it, so the button lands in the same place
  // either way.
  const { height: windowHeight } = useWindowDimensions();
  const screenRef = useRef<View>(null);
  const [gapBelow, setGapBelow] = useState(0);
  const measureGap = useCallback(() => {
    screenRef.current?.measureInWindow((_x, y, _w, h) => {
      if (!h) return;
      const gap = Math.max(0, Math.round(windowHeight - (y + h)));
      setGapBelow((prev) => (prev === gap ? prev : gap));
    });
  }, [windowHeight]);
  const { openMapsNavigation, timeOn, workday } = useWorkerContext();
  // With the workday clock on, nothing is started before the worker clocks in.
  const clockedIn = !timeOn || !!workday.active;
  const { projectWork } = useWorkerLanding();
  const checkIn = useMaintenanceCheckIn();
  const { yard, yardName, dayStart } = checkIn;
  useDb();

  const route = useMyMaintenanceRoute();
  const stops = route?.stops ?? [];
  const next = route?.nextStop;
  const upcoming = stops.filter(s => s.status === 'pending' || s.status === 'arrived');
  const allDone = !!route && stops.length > 0 && !next;
  // Who checks the crew in at each property: the route's crew leader (owner/admin may too). Everyone else sees status, not a button.
  const leader = isCrewLeader({ leadId: route?.lead?.id, personId: db.personId, role: db.role });
  const leaderName = route?.lead ? `${route.lead.firstName} ${route.lead.lastName}`.trim() : undefined;
  // The route is only shown once the worker's own workday has started (and only if they are scheduled at all).
  const showRoute = !!route && (!timeOn || clockedIn);

  // Shared with the stop screen, so a tap in either place can't finish twice.
  const finishing = useFinishingStop(next?.id);
  const busy = finishing || checkIn.busy != null;
  // A worker who goes straight to a property (missed the yard) can still work;
  // their day start stays missing for the owner to see.
  const [skippedYard, setSkippedYard] = useState(false);

  const now = new Date();
  const greeting = now.getHours() < 12 ? t('Good morning') : now.getHours() < 17 ? t('Good afternoon') : t('Good evening');
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const preShiftText = stops.length === 0
    ? t("Clocking in starts your workday and unlocks today's route.")
    : stops.length === 1
      ? t("Clocking in starts your workday and unlocks today's route (1 stop).")
      : t("Clocking in starts your workday and unlocks today's route ({n} stops).", { n: stops.length });

  // Start Day and I'M HERE (with their honest GPS prompts) come from useMaintenanceCheckIn.
  const handleStartDay = () => { haptics.select(); checkIn.startDay(route?.id); };
  const handleArrive = (stop: MaintenanceStopDetail) => { haptics.select(); checkIn.arriveAtStop(stop.id); };
  async function handleFinish(stop: MaintenanceStopDetail) {
    if (busy) return;
    if (missingRequirements(stop).length) {
      haptics.warning();
      // The stop screen is where the checklist and photos get done.
      openStop(stop);
      return;
    }
    haptics.select();
    const result = await finishStopAndAdvance(stop.id);
    if (result.ok) haptics.success();
    else if (result.missing.length) openStop(stop);
    else {
      haptics.warning();
      showMessage(t("Couldn't save that"), result.error ?? t('Please try again.'));
    }
  }

  function openStop(stop: MaintenanceStopDetail) {
    router.push(`/(worker)/maintenance-stop/${stop.id}` as any);
  }

  // ── Bottom action: one primary button for where the worker is in the day ──
  let action: { title: string; subtitle: string; icon: keyof typeof Feather.glyphMap; onPress: () => void; muted?: boolean } | null = null;
  // With the workday clock on, I'M HERE and FINISH STOP live on the property's own card (leader only); there is no floating button.
  const cardMode = timeOn;
  // Each worker checks in at each stop themselves, even when a crewmate got there first.
  const iCheckedIn = next ? !!checkIn.arrivalFor(next.id)?.mine : false;
  if (cardMode) {
    action = null;
  } else if (!timeOn && !dayStart.started && !skippedYard && !allDone) {
    action = {
      title: 'START DAY',
      subtitle: checkIn.busy === 'day' ? t('Finding your location…') : t('Check in at {yard}', { yard: yardName }),
      icon: 'sunrise',
      onPress: handleStartDay,
    };
  } else if (next && (next.status === 'pending' || !iCheckedIn)) {
    action = {
      title: timeOn ? 'START PROPERTY' : "I'M HERE",
      subtitle: checkIn.busy === next.id ? t('Finding your location…') : timeOn ? t('Start your time at this property') : t('Check in to start this stop'),
      icon: 'map-pin',
      onPress: () => handleArrive(next),
    };
  } else if (next && next.status === 'arrived') {
    const blockers = missingRequirements(next);
    action = {
      title: 'FINISH STOP',
      subtitle: finishing
        ? t('Saving…')
        : blockers.length > 1 ? t('{first} and {n} more', { first: blockers[0], n: blockers.length - 1 }) : blockers[0] ?? t('Mark this property done'),
      icon: 'check-circle',
      onPress: () => handleFinish(next),
      muted: blockers.length > 0,
    };
  }

  // Distance from the container's bottom edge up to just above the tab bar (never below a small margin).
  const bottomOffset = Math.max((Platform.OS === 'ios' ? tabBarClearance - spacing.sm : spacing.md) - gapBelow, spacing.md);
  const scrollPadding = Math.max(tabBarClearance - gapBelow, spacing.md) + (action ? ACTION_AREA + (dayStart.started || !route ? 0 : 24) : 0);

  return (
    <View ref={screenRef} onLayout={measureGap} style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: scrollPadding }}>
        <View style={styles.hero}>
          <BrandCover uri={getWorkerHeaderImageUri()} style={styles.heroImage} />
          <LinearGradient
            colors={['rgba(0,0,0,0.35)', 'transparent', 'rgba(0,0,0,0.18)']}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.weatherWrap, { top: insets.top + spacing.sm }]}>
            <WeatherButton to="/(worker)/weather" />
          </View>
          <View style={styles.heroText}>
            <Text style={[typeScale.bodySmall, styles.heroShadow, { color: '#FFFFFF' }]}>{dateStr}</Text>
            <Text style={[typeScale.displayLarge, styles.heroShadow, { color: '#FFFFFF', marginTop: 2 }]}>{greeting}</Text>
            <Text style={[typeScale.bodyLarge, styles.heroShadow, { color: '#FFFFFF', marginTop: spacing.xs }]}>
              {route ? t("Here's your maintenance route for today.") : t('Maintenance crew')}
            </Text>
          </View>
        </View>

        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          {projectWork ? (
            <OtherWorkCard icon="briefcase" title={t('You also have project work')} subtitle={t('Tap to see your jobs.')} onPress={() => router.push('/(worker)/(tabs)' as any)} />
          ) : null}
          {timeOn ? null : (
            <YardStartCard
              dayStart={dayStart}
              yard={yard}
              yardName={yardName}
              onYardPress={yard ? () => { haptics.select(); openMapsNavigation(yard); } : undefined}
            />
          )}

          {!route ? (
            timeOn ? null : (
              <EmptyState
                icon="map"
                title={t('No route today')}
                description={t('When the owner puts you on a maintenance route, its stops show up here.')}
              />
            )
          ) : !showRoute ? null : (
            <View>
              <View style={styles.routeHeader}>
                <MaterialCommunityIcons name="map-marker-path" size={30} color={colors.primary} />
                <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginLeft: spacing.sm, flex: 1 }]}>
                  {t("Today's Route")}
                </Text>
              </View>
              {route.lead && (
                <View style={styles.leadRow}>
                  <Feather name="star" size={13} color={colors.textTertiary} />
                  <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
                    {route.lead.id === user?.id ? t('You are the route lead') : t('Lead: {name}', { name: `${route.lead.firstName} ${route.lead.lastName}`.trim() })}
                  </Text>
                </View>
              )}
              {stops.length > 0 ? (
                <View style={{ marginTop: spacing.md }}>
                  <RouteProgress stops={stops} nextStopId={next?.id} />
                </View>
              ) : (
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.sm }]}>
                  {t("This route doesn't have any stops yet.")}
                </Text>
              )}

              {route.notes ? (
                <View style={[styles.note, { backgroundColor: colors.backgroundSecondary, marginTop: spacing.md }]}>
                  <Feather name="file-text" size={14} color={colors.textSecondary} />
                  <Text style={[typeScale.bodySmall, styles.noteText, { color: colors.textPrimary }]}>{route.notes}</Text>
                </View>
              ) : null}

              {next && (
                <NextStopCard
                  stop={next}
                  crewMode={cardMode}
                  leader={leader}
                  leaderName={leaderName}
                  busy={busy}
                  starting={checkIn.busy === next.id}
                  finishing={finishing}
                  onArrive={() => handleArrive(next)}
                  onFinish={() => handleFinish(next)}
                  onOpen={() => openStop(next)}
                  onDirections={next.property ? () => { haptics.select(); openMapsNavigation(next.property!); } : undefined}
                />
              )}

              {allDone && (
                <View style={[styles.doneBox, { backgroundColor: colors.primarySurface }]}>
                  <Feather name="check-circle" size={22} color={colors.primaryDark} />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{t('Route complete')}</Text>
                    <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
                      {t('Every stop is finished. Nice work today.')}
                    </Text>
                  </View>
                </View>
              )}

              {/* The last stop is done: the leader decides when the crew's workdays end (nothing is clocked out by itself). */}
              {allDone && timeOn && leader && route ? <CrewClockOutCard routeId={route.id} /> : null}
            </View>
          )}

          {showRoute && stops.length > 0 && (
            <View>
              <Text style={[typeScale.headingLarge, { color: colors.textPrimary, marginBottom: spacing.sm }]}>
                {upcoming.length > 0 ? t('Stops') : t('Stops today')}
              </Text>
              <View style={[styles.listCard, { borderColor: colors.border }]}>
                {stops.map((s, i) => (
                  <StopRow
                    key={s.id}
                    stop={s}
                    nextStopId={next?.id}
                    first={i === 0}
                    showInstructions={s.id === next?.id}
                    locked={s.status === 'pending' && s.id !== next?.id}
                    onPress={() => openStop(s)}
                  />
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {action && (
        <View
          style={[styles.actionArea, { bottom: bottomOffset }]}
          pointerEvents="box-none"
        >
          <LinearGradient
            pointerEvents="none"
            colors={['transparent', colors.surface, colors.surface]}
            locations={[0, 0.35, 1]}
            style={styles.actionFade}
          />
          <Pressable
            onPress={action.onPress}
            disabled={!!busy}
            accessibilityRole="button"
            accessibilityLabel={`${t(action.title)}. ${action.subtitle}`}
            style={({ pressed }) => [pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] }]}
          >
            <View style={[styles.actionButton, { backgroundColor: action.muted ? colors.primary : colors.primaryDark }]}>
              <View style={styles.actionRow}>
                <Feather name={action.icon} size={20} color="#FFFFFF" />
                <Text style={[typeScale.headingSmall, styles.actionTitle]}>{t(action.title)}</Text>
              </View>
              <Text style={[typeScale.bodySmall, { color: 'rgba(255,255,255,0.9)', marginTop: 2 }]} numberOfLines={1}>
                {action.subtitle}
              </Text>
            </View>
          </Pressable>
          {action.title === 'START DAY' && next && (
            <Pressable
              onPress={() => { haptics.select(); setSkippedYard(true); }}
              hitSlop={8}
              style={styles.secondaryLink}
              accessibilityRole="button"
            >
              <Text style={[typeScale.labelLarge, { color: colors.primaryDark }]}>{t('Already at a property? Check in there')}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function NextStopCard({ stop, onOpen, onDirections, crewMode, leader, leaderName, busy, starting, finishing, onArrive, onFinish }: {
  stop: MaintenanceStopDetail; onOpen: () => void; onDirections?: () => void;
  crewMode?: boolean; leader?: boolean; leaderName?: string; busy?: boolean; starting?: boolean; finishing?: boolean; onArrive?: () => void; onFinish?: () => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const blockers = missingRequirements(stop);
  const status = displayStatus(stop, stop.id);
  const requiredTasks = stop.tasks.filter(task => task.isRequired);
  const tasksDone = requiredTasks.filter(task => task.completedAt).length;
  const arrivedBy = firstName(stop.arrivedBy);

  return (
    <View style={[styles.nextCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Pressable onPress={onOpen} style={({ pressed }) => [styles.nextTop, pressed && { opacity: 0.85 }]} accessibilityRole="button">
        <View style={styles.nextTitleRow}>
          <View style={[styles.headerIcon, { backgroundColor: colors.primarySurface }]}>
            <Feather name="home" size={16} color={colors.primaryDark} />
          </View>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary, marginLeft: spacing.sm, flex: 1 }]} numberOfLines={2}>
            {stop.property?.name ?? t('Property')}
          </Text>
        </View>
        <View style={styles.nextBody}>
          <View style={{ flex: 1 }}>
            <View style={styles.meta}>
              <Feather name="map-pin" size={13} color={colors.textTertiary} />
              <Text style={[typeScale.bodySmall, styles.metaText, { color: colors.textSecondary }]} numberOfLines={2}>
                {stopAddress(stop)}
              </Text>
            </View>
            <View style={styles.meta}>
              <ServiceIcon label={servicesLabel(stop)} size={15} color={colors.primary} />
              <Text style={[typeScale.bodySmall, styles.metaText, { color: colors.textSecondary }]} numberOfLines={2}>
                {servicesLabel(stop)}
              </Text>
            </View>
            <View style={[styles.meta, { marginTop: spacing.sm }]}>
              <StopStatusPill status={status} icon />
            </View>
          </View>
          {stop.property && <JobMap place={stop.property} height={92} style={styles.map} />}
        </View>
        {stop.status === 'arrived' && stop.arrivedAt && (
          <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.sm }]} numberOfLines={2}>
            {arrivedBy ? t('Checked in {time} by {name}', { time: formatClock(stop.arrivedAt), name: arrivedBy }) : t('Checked in {time}', { time: formatClock(stop.arrivedAt) })} · {t(locationLabel(stop.arrivalLocationStatus))}
          </Text>
        )}
      </Pressable>

      {stop.instructions ? (
        <View style={[styles.note, { backgroundColor: colors.primarySurface, marginHorizontal: spacing.md }]}>
          <Feather name="info" size={14} color={colors.primaryDark} />
          <Text style={[typeScale.bodySmall, styles.noteText, { color: colors.textPrimary }]}>{stop.instructions}</Text>
        </View>
      ) : null}
      {stop.property?.accessNotes ? (
        <View style={[styles.note, { backgroundColor: colors.backgroundSecondary, marginHorizontal: spacing.md, marginTop: spacing.sm }]}>
          <Feather name="key" size={14} color={colors.textSecondary} />
          <Text style={[typeScale.bodySmall, styles.noteText, { color: colors.textPrimary }]}>{stop.property.accessNotes}</Text>
        </View>
      ) : null}

      {(requiredTasks.length > 0 || stop.requiresPhotos) && (
        <Pressable onPress={onOpen} style={styles.requirements} accessibilityRole="button">
          {requiredTasks.length > 0 && (
            <View style={styles.reqItem}>
              <Feather name="check-square" size={14} color={tasksDone === requiredTasks.length ? colors.success : colors.textSecondary} />
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
                {t('Checklist {done}/{total}', { done: tasksDone, total: requiredTasks.length })}
              </Text>
            </View>
          )}
          {stop.requiresPhotos && (
            <View style={styles.reqItem}>
              <Feather name="camera" size={14} color={stop.photos.length >= stop.minPhotos ? colors.success : colors.textSecondary} />
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
                {t('Photos {done}/{total}', { done: Math.min(stop.photos.length, stop.minPhotos), total: stop.minPhotos })}
              </Text>
            </View>
          )}
        </Pressable>
      )}

      {crewMode ? (
        <View style={[styles.cardAction, { borderTopColor: colors.border }]}>
          {leader ? (
            stop.status === 'pending' ? (
              <Pressable onPress={onArrive} disabled={!!busy} accessibilityRole="button" accessibilityLabel={t("I'm here at {name}", { name: stop.property?.name ?? t('this property') })}
                style={({ pressed }) => [styles.cardButton, { backgroundColor: colors.primaryDark, opacity: busy ? 0.6 : pressed ? 0.9 : 1 }]}>
                <Feather name="map-pin" size={18} color="#FFFFFF" />
                <Text style={[typeScale.labelLarge, styles.cardButtonText]}>{starting ? t('Finding your location…') : t("I'M HERE")}</Text>
              </Pressable>
            ) : stop.status === 'arrived' ? (
              <Pressable onPress={onFinish} disabled={!!busy} accessibilityRole="button" accessibilityLabel={t('Finish stop')}
                style={({ pressed }) => [styles.cardButton, { backgroundColor: blockers.length ? colors.primary : colors.primaryDark, opacity: busy ? 0.6 : pressed ? 0.9 : 1 }]}>
                <Feather name="check-circle" size={18} color="#FFFFFF" />
                <Text style={[typeScale.labelLarge, styles.cardButtonText]}>
                  {finishing ? t('Saving…') : blockers.length ? `${t('FINISH STOP')} · ${blockers[0]}${blockers.length > 1 ? ` +${blockers.length - 1}` : ''}` : t('FINISH STOP')}
                </Text>
              </Pressable>
            ) : null
          ) : (
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
              {crewStopMessage(stop.status, leaderName, stop.arrivedAt ? formatClock(stop.arrivedAt) : null, arrivedBy, !!leaderName)}
            </Text>
          )}
        </View>
      ) : null}

      {onDirections && (
        <Pressable
          onPress={onDirections}
          style={({ pressed }) => [styles.mapsRow, { borderTopColor: colors.border }, pressed && { backgroundColor: colors.surfacePressed }]}
          accessibilityRole="button"
          accessibilityLabel={t('Open in Maps')}
        >
          <Feather name="navigation" size={16} color={colors.primary} />
          <Text style={[typeScale.bodyLarge, { color: colors.primary, flex: 1, marginLeft: spacing.sm, fontWeight: '600' }]}>
            {t('Open in Maps')}
          </Text>
          <Feather name="chevron-right" size={18} color={colors.textTertiary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: { height: HERO_HEIGHT, width: '100%' },
  weatherWrap: { position: 'absolute', left: spacing.lg },
  heroImage: { width: '100%', height: '100%' },
  heroText: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing['3xl'] + spacing.sm },
  heroShadow: { textShadowColor: 'rgba(0, 0, 0, 0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  sheet: {
    marginHorizontal: spacing.md,
    marginTop: -SHEET_RADIUS,
    padding: spacing.lg,
    gap: spacing.lg,
    borderRadius: SHEET_RADIUS,
  },
  routeHeader: { flexDirection: 'row', alignItems: 'center' },
  leadRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  headerIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', alignItems: 'flex-start', padding: spacing.sm, borderRadius: radius.sm },
  noteText: { marginLeft: spacing.xs, flex: 1 },
  nextCard: { marginTop: spacing.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  nextTop: { padding: spacing.md },
  nextBody: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.xs },
  nextTitleRow: { flexDirection: 'row', alignItems: 'center' },
  map: { width: 104, borderRadius: radius.md, overflow: 'hidden', marginTop: 6 },
  meta: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  metaText: { marginLeft: spacing.xs, flexShrink: 1 },
  requirements: { flexDirection: 'row', gap: spacing.lg, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  reqItem: { flexDirection: 'row', alignItems: 'center' },
  mapsRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: spacing.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderTopWidth: StyleSheet.hairlineWidth,
  },
  notScheduled: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg },
  cardAction: { marginTop: spacing.md, paddingTop: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  cardButton: { height: 52, borderRadius: radius.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  cardButtonText: { color: '#FFFFFF', fontWeight: '700', letterSpacing: 0.4 },
  doneBox: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.lg },
  listCard: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  actionArea: { position: 'absolute', left: spacing.lg, right: spacing.lg, alignItems: 'stretch' },
  actionFade: { position: 'absolute', left: -spacing.lg, right: -spacing.lg, top: -spacing.xl, bottom: -spacing['3xl'] },
  actionButton: { height: 68, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  actionRow: { flexDirection: 'row', alignItems: 'center' },
  actionTitle: { color: '#FFFFFF', marginLeft: spacing.sm, fontWeight: '700', letterSpacing: 0.5 },
  secondaryLink: { alignSelf: 'center', marginTop: spacing.sm, paddingVertical: spacing.xs },
});

/**
 * Today for a maintenance worker. With the time clock installed this is the simple Today (clock-in first, then the route). The older
 * screen above is kept only for a database that has not got the time clock yet (legacy Start Day / I'm Here flow).
 */
export default function MaintenanceTodayScreen() {
  const { workday } = useWorkerContext();
  return workday.installed === false ? <LegacyMaintenanceToday /> : <WorkerToday />;
}
