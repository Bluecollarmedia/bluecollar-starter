import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, Platform, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { useWorkerContext } from '@/providers/WorkerProvider';
import { TruckPickSheet } from '@/components/time/TruckPickSheet';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { clockText, durationText, intervalMs } from '@/lib/timeCalc';
import { haptics } from '@/lib/haptics';
import { StaleSessionCard } from '@/components/time/StaleSessionCard';
import type { TruckOptions } from '@/data/timeTracking';
import { useT, tr } from '@/i18n';
import { useMyMaintenanceRoutes } from '@/hooks/useMaintenance';

function say(title: string, message: string) {
  if (Platform.OS === 'web') (globalThis as { alert?: (m: string) => void }).alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}
const timeOfDay = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayAndTime = (iso: string) => `${new Date(iso).toLocaleDateString('en-US', { weekday: 'short' })} ${timeOfDay(iso)}`;

/**
 * The employee's workday: Clock In at the yard, the running day total, the truck, an optional break, and Clock Out. The timer runs
 * from the stored clock-in time (server time), so closing and reopening the app never resets it, and walking between properties
 * never restarts it. Shows nothing until the database update is installed (the older check-in screens keep working then).
 *
 * gate = the Today screens' version: ONLY the Clock In button (before clocking in, or again when work remains). Once there is a running
 * day it shows nothing at all: no timer, no total, no Clock Out, no "didn't clock out" card. It reads the same clock state as everything
 * else (w.active is only ever a current, non-stale session), so hiding it never changes whether the worker is clocked in. The only
 * clock-out is the small row in Settings.
 */
export function WorkdayCard({ compact = false, gate = false, portal = false, preShiftTitle, preShiftText }: { compact?: boolean; gate?: boolean; /** The Clock tab: big Clock Out, and a clear Clock back in after clocking out. */ portal?: boolean; preShiftTitle?: string; preShiftText?: string } = {}) {
  const { colors } = useTheme();
  const { workday: w, todayAssignments } = useWorkerContext();
  const myRoutes = useMyMaintenanceRoutes();
  const t = useT();
  const [pickTruck, setPickTruck] = useState<TruckOptions | null>(null);
  const [loadingTrucks, setLoadingTrucks] = useState(false);
  // Only this card ticks every second (the timer); nothing else in the app is redrawn.
  const [, setTick] = useState(0);
  const running = !!w.active;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  const nowMs = Date.now() + w.clockOffsetMs;
  const todayNetMs = w.netMsAt(nowMs);
  // A running day that began before today (an overnight job) is labelled with its day. A day open for much longer is never "running": it is `w.stale`.
  const fromEarlier = !!w.active && new Date(w.active.clockInAt).toDateString() !== new Date(nowMs).toDateString();

  // The dashboards never pop up a Clock In: clocking in and out is manual, on the Clock tab (the card there is `portal`).
  if (gate) return null;
  if (w.installed !== true) return null;
  const active = w.active;
  const closedToday = !active ? w.today : undefined;
  const current = w.day?.current;
  // No route or job today: no Clock In button at all (the database refuses a clock-in too).
  // Clocking in is always possible, with or without work scheduled (the database no longer refuses it).
  const noWork = false;
  // Clocked out for the day, but work was added afterwards (a new job today, or route stops still open): offer to clock back in right away.
  const moreWork = todayAssignments.some((a) => a.status !== 'completed' && a.status !== 'cancelled') || myRoutes.some((r) => r.stops.some((st) => st.status === 'pending' || st.status === 'arrived'));

  async function onClockIn() {
    haptics.select();
    setLoadingTrucks(true);
    const opts = await w.loadTrucks();
    setLoadingTrucks(false);
    if (!opts.ok) { say(tr("Couldn't start your workday"), opts.error); return; }
    // The owner already assigned a truck: use it, no choice to make. Otherwise let the worker pick (or go without).
    if (opts.data.assignedTruckId || opts.data.trucks.length === 0) { await doClockIn(undefined); return; }
    setPickTruck(opts.data);
  }
  async function doClockIn(truckId?: string) {
    setPickTruck(null);
    const r = await w.clockIn(truckId);
    if (r.ok) haptics.success(); else say(tr("Couldn't start your workday"), r.error);
  }
  function onClockOut() {
    haptics.select();
    const total = durationText(todayNetMs);
    const message = current
      ? tr('Clocking out also ends your time at {place}. Your total for today is {total}.', { place: current.label ?? tr('the property you are at'), total })
      : tr('Your total for today is {total}.', { total });
    const go = async () => { const r = await w.clockOut(); if (r.ok) haptics.success(); else say(tr("Can't clock out yet"), r.error); };
    Alert.alert(tr('Clock out?'), message, [{ text: tr('Not yet'), style: 'cancel' }, { text: tr('Clock Out'), style: 'destructive', onPress: go }]);
  }
  async function onBreak() {
    haptics.select();
    const r = w.onBreak ? await w.endBreak() : await w.startBreak();
    if (!r.ok) say(w.onBreak ? tr("Couldn't end the break") : tr("Couldn't start the break"), r.error);
  }

  // The Today screens' version shows only the Clock In button. When there is nothing to show (a running day), draw nothing, not an empty white card.
  const gateShowsButton = !active && !noWork && (!closedToday || (moreWork && w.day?.canClockIn !== false));
  if (gate && !gateShowsButton && !w.error) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, shadow.md]}>
      {w.stale && !gate ? (
        <StaleSessionCard
          session={{ id: w.stale.id, clockInAt: w.stale.clockInAt, claimedOutAt: w.stale.claimedOutAt, claimNote: w.stale.claimNote, answered: !!w.stale.claimedAt }}
          busy={w.busy}
          nowMs={nowMs}
          onAnswer={(iso) => w.claimStale(w.stale!.id, iso)}
          error={w.error}
        />
      ) : null}
      {noWork && !closedToday && !gate ? (
        <>
          <View style={styles.head}>
            <View style={[styles.icon, { backgroundColor: colors.backgroundTertiary }]}><Feather name="calendar" size={18} color={colors.textSecondary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{t('No work scheduled today')}</Text>
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{t('Clock In appears once you are put on a route or a job for the day.')}</Text>
            </View>
          </View>
        </>
      ) : null}

      {!active && !noWork && (!closedToday || (gate && moreWork && w.day?.canClockIn !== false)) ? (
        <>
          <View style={styles.head}>
            <View style={[styles.icon, { backgroundColor: colors.primarySurface }]}><Feather name="sunrise" size={18} color={colors.primaryDark} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{preShiftTitle ?? 'Start your workday'}</Text>
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{preShiftText ?? 'Clock in when you start work at the yard.'}</Text>
            </View>
          </View>
          <Pressable onPress={onClockIn} disabled={w.busy || loadingTrucks} style={[styles.primary, { backgroundColor: colors.primary, opacity: w.busy || loadingTrucks ? 0.6 : 1 }]} accessibilityRole="button">
            {w.busy || loadingTrucks ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[typeScale.labelLarge, { color: '#FFFFFF' }]}>{t('Clock In')}</Text>}
          </Pressable>
        </>
      ) : null}

      {active && compact && !gate ? (
        <>
          <View style={styles.head}>
            <View style={[styles.dot, { backgroundColor: w.onBreak ? colors.warning : colors.success }]} />
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{w.onBreak ? t('On break') : t('On the clock')}</Text>
              <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                {t('since')} {fromEarlier ? dayAndTime(active.clockInAt) : timeOfDay(active.clockInAt)}{active.truck ? ` · ${active.truck.name}` : ''}
              </Text>
            </View>
            {w.day?.settings.breaksEnabled ? (
              <Pressable onPress={onBreak} disabled={w.busy} hitSlop={8} accessibilityRole="button" style={[styles.secondary, { borderColor: colors.border, opacity: w.busy ? 0.5 : 1 }]}>
                <Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>{w.onBreak ? t('End Break') : t('Break')}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onClockOut} disabled={w.busy} hitSlop={8} accessibilityRole="button" style={[styles.secondary, { borderColor: colors.border, opacity: w.busy ? 0.5 : 1 }]}>
              <Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>{t('Clock Out')}</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {active && !compact && !gate ? (
        <>
          <View style={styles.head}>
            <View style={[styles.dot, { backgroundColor: w.onBreak ? colors.warning : colors.success }]} />
            <Text style={[typeScale.overline, { color: colors.textSecondary, flex: 1 }]}>{w.onBreak ? 'ON BREAK' : 'WORKDAY'}</Text>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{t('since')} {fromEarlier ? dayAndTime(active.clockInAt) : timeOfDay(active.clockInAt)}</Text>
          </View>
          <Text style={[styles.timer, { color: colors.textPrimary }]} accessibilityLabel={`${t('Workday total')} ${durationText(todayNetMs)}`}>{clockText(todayNetMs)}</Text>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{t('Workday total')}</Text>

          {active.truck ? (
            <View style={styles.row}>
              <Feather name="truck" size={14} color={colors.textTertiary} />
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{active.truck.name}{active.truck.source === 'owner' ? ' · assigned' : ''}</Text>
            </View>
          ) : null}
          {current ? (
            <View style={[styles.row, { marginTop: spacing.xs }]}>
              <Feather name="map-pin" size={14} color={colors.primary} />
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]} numberOfLines={1}>
                At {current.label ?? 'a property'} · {durationText(intervalMs({ startedAt: current.startedAt, status: 'active' }, nowMs))}
              </Text>
            </View>
          ) : null}

          <View style={styles.buttons}>
            {w.day?.settings.breaksEnabled ? (
              <Pressable onPress={onBreak} disabled={w.busy || (!!current && !w.onBreak)} style={[styles.secondary, { borderColor: colors.border, opacity: w.busy || (!!current && !w.onBreak) ? 0.5 : 1 }]} accessibilityRole="button">
                <Feather name={w.onBreak ? 'play' : 'coffee'} size={15} color={colors.textPrimary} />
                <Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>{w.onBreak ? 'End Break' : 'Start Break'}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onClockOut} disabled={w.busy} style={[styles.secondary, portal ? { height: 56, backgroundColor: colors.error, borderColor: colors.error } : { borderColor: colors.border }, { opacity: w.busy ? 0.5 : 1 }]} accessibilityRole="button">
              <Feather name="log-out" size={portal ? 18 : 15} color={portal ? '#FFFFFF' : colors.textPrimary} />
              <Text style={[portal ? typeScale.labelLarge : typeScale.labelSmall, { color: portal ? '#FFFFFF' : colors.textPrimary }]}>{t('Clock Out')}</Text>
            </Pressable>
          </View>
          {current && !w.onBreak ? (
            <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.xs }]}>{t('Clocking out for the day also ends your time at the property you are at.')}</Text>
          ) : null}
        </>
      ) : null}

      {closedToday && !gate ? (
        <>
          <View style={styles.head}>
            <View style={[styles.icon, { backgroundColor: colors.successLight ?? colors.primarySurface }]}><Feather name="check" size={18} color={colors.success} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{t('Workday complete')}</Text>
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
                Total {durationText(todayNetMs)} · {timeOfDay(closedToday.clockInAt)} to {closedToday.clockOutAt ? timeOfDay(closedToday.clockOutAt) : ''}
              </Text>
            </View>
          </View>
          {portal && w.day?.canClockIn !== false ? (
            <>
              <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.sm }]}>{t('Clocked out by mistake? Clock back in and your day keeps going.')}</Text>
              <Pressable onPress={onClockIn} disabled={w.busy || loadingTrucks} accessibilityRole="button" style={[styles.primary, { backgroundColor: colors.primary, opacity: w.busy || loadingTrucks ? 0.6 : 1 }]}>
                {w.busy || loadingTrucks ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[typeScale.labelLarge, { color: '#FFFFFF' }]}>{t('Clock back in')}</Text>}
              </Pressable>
            </>
          ) : w.day?.canClockIn !== false && moreWork ? (
            <Pressable onPress={onClockIn} disabled={w.busy || loadingTrucks} accessibilityRole="button" style={[styles.secondary, { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark, marginTop: spacing.sm, alignItems: 'center' }]}>
              <Text style={[typeScale.labelLarge, { color: '#FFFFFF' }]}>{t('You have more work today. Clock back in')}</Text>
            </Pressable>
          ) : w.day?.canClockIn !== false ? (
            <Pressable onPress={onClockIn} disabled={w.busy || loadingTrucks} hitSlop={8} style={{ marginTop: spacing.sm }}>
              <Text style={[typeScale.labelSmall, { color: colors.primary }]}>{t('Clocked out by mistake? Clock back in')}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {w.error ? <Text style={[typeScale.caption, { color: colors.error, marginTop: spacing.sm }]}>{w.error}</Text> : null}

      <TruckPickSheet options={pickTruck} onPick={doClockIn} onClose={() => setPickTruck(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  timer: { fontSize: 44, lineHeight: 52, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  primary: { height: 52, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  secondary: { flex: 1, height: 44, borderRadius: radius.full, borderWidth: 1, flexDirection: 'row', gap: spacing.xs, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing['3xl'] },
  truckRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth },
});
