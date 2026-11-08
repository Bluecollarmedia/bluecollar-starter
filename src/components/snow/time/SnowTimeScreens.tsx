/**
 * Snow time clock (update 028). Worker: Clock In / Clock Out and this
 * week's shifts. Owner: everyone's shifts this week with totals, and a
 * one-tap "Clock out now" correction for a shift someone forgot to end.
 * Working layout in the existing app style; no approved mockup yet.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useT } from '@/i18n';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, InlineNotice, LoadingSpinner, ScreenHeader } from '@/components/ui';
import { CollapsibleFilters } from '@/components/ui/CollapsibleFilters';
import { confirmAction, showMessage } from '@/components/financials/ActionSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { useSnowClock } from '@/hooks/useSnowClock';
import { SnowStaleShiftCard } from './SnowStaleShiftCard';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  canClockIn, clockIn, clockOut, correctShift, formatClock, formatHours, loadShifts, shiftHours, startOfWeekIso, type SnowShift,
} from '@/data/snowShifts';
import { loadStorms } from '@/data/snowStorms';
import type { SnowStorm } from '@/types/snow';
import {
  SHORT_SHIFT_MINUTES, addDays, countUntaggedDuring, dayKeyOf, filterShifts, groupByWorkerDay, isShortShift, shiftMs, weekStartDay,
} from '@/lib/snowHours';
import { ShiftCorrectionSheet } from './ShiftCorrectionSheet';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

function useShifts() {
  const [shifts, setShifts] = useState<SnowShift[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    const res = await loadShifts(startOfWeekIso());
    setLoading(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setShifts(res.data);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  // Tabs stay mounted: when the person comes back to this screen (for example after clocking in on the Route page), read it again.
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  return { shifts, error, loading, reload, setShifts };
}

function ShiftRow({ s, first, name, action, flag }: { s: SnowShift; first: boolean; name?: string; action?: React.ReactNode; flag?: string }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View style={[styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}>
      <View style={{ flex: 1, gap: 2 }}>
        {name ? <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{name}</Text> : null}
        <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
          {formatClock(s.clockInAt)} – {s.clockOutAt ? new Date(s.clockOutAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : t('now')}
        </Text>
        {s.corrected ? (
          // The reason is what the owner typed; the two the app writes itself have a Spanish version, anything else shows as written.
          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{t('Corrected: {reason}', { reason: t(s.correctionReason ?? '') })}</Text>
        ) : null}
        {s.flaggedAt && !s.corrected ? (
          <Text style={[typeScale.caption, { color: colors.warning }]}>
            {s.claimedOutAt
              ? (name
                ? t('Never clocked out. {name} say they stopped {time}. Counts as zero hours until the end time is set.', { name, time: formatClock(s.claimedOutAt) })
                : t('Never clocked out. They say they stopped {time}. Counts as zero hours until the end time is set.', { time: formatClock(s.claimedOutAt) }))
              : s.claimedAt ? t('Never clocked out. Not sure when they stopped. Counts as zero hours until the end time is set.') : t('Never clocked out. Counts as zero hours until the end time is set.')}
          </Text>
        ) : null}
        {flag ? <Text style={[typeScale.caption, { color: colors.warning }]}>{flag}</Text> : null}
        {action}
      </View>
      <Text style={[typeScale.labelLarge, { color: s.clockOutAt ? colors.textSecondary : colors.primary }]}>{formatHours(shiftHours(s))}</Text>
    </View>
  );
}

/** Worker "Time" tab. */
export function SnowTimeClockScreen() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const { shifts, error, loading, reload } = useShifts();
  const [busy, setBusy] = useState(false);
  const [allowed, setAllowed] = useState(true);
  // One clock, read the same way on every Snow screen. A shift never clocked out of is never `open` (it is `stale`).
  const clock = useSnowClock();
  const open = clock.open ?? undefined;
  const [clockError, setClockError] = useState<string | null>(null);
  // Not on a running storm route: no Clock In button (an open shift always keeps its Clock Out).
  useEffect(() => { canClockIn().then(setAllowed); }, [shifts.length, open?.id]);
  // Clocking in is manual and always possible: not on a route, no storm dispatched, no job started: the worker can still clock in and out here.
  void allowed;
  const blocked = false;
  const week = shifts.reduce((sum, s) => sum + shiftHours(s), 0);

  async function toggle() {
    setBusy(true);
    setClockError(null);
    const res = open ? await clockOut() : await clockIn();
    setBusy(false);
    // A failure stays on the screen (not only a pop-up that disappears): the worker must never think they are clocked out when they are not.
    if (!res.ok) {
      const what = open ? t("Couldn't clock out") : t("Couldn't clock in");
      const why = t(res.error);
      setClockError(open ? t('{what}: {error} You are still clocked in.', { what, error: why }) : t('{what}: {error} You are still not clocked in.', { what, error: why }));
      showMessage(what, why);
    }
    await clock.refresh();
    reload();
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: tabBarClearance + spacing.lg }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
      >
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>{t('Time Clock')}</Text>
        {error ? <InlineNotice icon="alert-circle" tone="error" text={t(error)} style={{ marginTop: spacing.md }} /> : null}
        {clockError ? <InlineNotice icon="alert-circle" tone="error" text={clockError} style={{ marginTop: spacing.md }} /> : null}
        {clock.stale ? <View style={{ marginTop: spacing.md }}><SnowStaleShiftCard shift={clock.stale} busy={clock.busy} onAnswer={async (iso) => { const e = await clock.claimStale(clock.stale!.id, iso); reload(); return e; }} /></View> : null}
        {loading ? <LoadingSpinner /> : (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface, marginTop: spacing.md, alignItems: 'center', gap: spacing.sm }]}>
              <Text style={[typeScale.overline, { color: colors.textSecondary }]}>{open ? t('Clocked in') : t('Not clocked in')}</Text>
              <Text style={[typeScale.displaySmall, { color: open ? colors.primary : colors.textPrimary }]}>
                {open ? formatHours(shiftHours(open)) : formatHours(week)}
              </Text>
              <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                {open ? t('Since {time}', { time: formatClock(open.clockInAt) }) : t('This week')}
              </Text>
              {blocked ? (
                <>
                  <Text style={[typeScale.headingSmall, { color: colors.textPrimary, textAlign: 'center', marginTop: spacing.sm }]}>{t('No active storm assignment')}</Text>
                  <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center' }]}>
                    {t('Clock In appears once the owner puts you on a route for a storm that has been dispatched.')}
                  </Text>
                </>
              ) : (
                <Button
                  title={open ? t('Clock Out') : t('Clock In')}
                  icon={open ? 'log-out' : 'log-in'}
                  variant={open ? 'danger' : 'primary'}
                  loading={busy}
                  onPress={toggle}
                  fullWidth
                  style={{ marginTop: spacing.sm }}
                />
              )}
              <Text style={[typeScale.caption, { color: colors.textTertiary, textAlign: 'center' }]}>
                {t('No location is used. Snow hours are kept apart from landscaping hours.')}
              </Text>
            </View>

            <Text style={[typeScale.overline, styles.label, { color: colors.textSecondary }]}>{t('This week · {hours}', { hours: formatHours(week) })}</Text>
            {shifts.length ? (
              <View style={[styles.group, { backgroundColor: colors.surface }]}>
                {shifts.map((s, i) => <ShiftRow key={s.id} s={s} first={i === 0} />)}
              </View>
            ) : (
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginHorizontal: spacing.sm }]}>{t('No shifts yet this week.')}</Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

type RangeKey = 'this_week' | 'last_week' | 'last_30';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'last_30', label: 'Last 30 days' },
];

function rangeDays(key: RangeKey): { fromDay: string; toDay: string } {
  const today = dayKeyOf(new Date().toISOString());
  if (key === 'this_week') return { fromDay: weekStartDay(), toDay: today };
  if (key === 'last_week') return { fromDay: weekStartDay(new Date(), 1), toDay: addDays(weekStartDay(), -1) };
  return { fromDay: addDays(today, -29), toDay: today };
}

const dayLabel = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
const msToHours = (ms: number) => ms / 3_600_000;

/** Owner "Snow hours": filter by worker, storm and dates; grouped by worker and day with totals. */
export function SnowHoursScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [shifts, setShifts] = useState<SnowShift[]>([]);
  const [storms, setStorms] = useState<SnowStorm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [names, setNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<SnowShift | null>(null);
  // Opened from "X is still clocked in" on the dashboard: that worker, over 30 days (their open shift may be days old).
  const { person } = useLocalSearchParams<{ person?: string }>();
  const [range, setRange] = useState<RangeKey>(person ? 'last_30' : 'this_week');
  const [stormId, setStormId] = useState<string | null>(null);
  const [personId, setPersonId] = useState<string | null>(person ? String(person) : null);
  const [onlyReview, setOnlyReview] = useState(false);
  const [includeUntagged, setIncludeUntagged] = useState(false);
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});

  const storm = storms.find((s) => s.id === stormId);
  const days = rangeDays(range);

  const reload = useCallback(async () => {
    // A storm shows the shifts that overlap its dispatch-to-end time; otherwise the chosen dates.
    const since = storm?.dispatchedAt
      ? new Date(new Date(storm.dispatchedAt).getTime() - 24 * 3_600_000).toISOString()
      : new Date(`${days.fromDay}T00:00:00`).toISOString();
    // A storm that is running (or was reopened) has no end yet; only a storm that is ended has one.
    const until = storm ? (storm.status === 'ended' ? storm.endedAt : undefined) : new Date(`${addDays(days.toDay, 1)}T00:00:00`).toISOString();
    const res = await loadShifts(since, until);
    setLoading(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setShifts(res.data);
  }, [storm?.id, storm?.dispatchedAt, storm?.endedAt, days.fromDay, days.toDay]);

  useEffect(() => { setLoading(true); reload(); }, [reload]);
  useEffect(() => {
    loadStorms().then((r) => { if (r.ok) setStorms(r.data.filter((s) => s.status !== 'draft' && s.dispatchedAt)); });
  }, []);

  useEffect(() => {
    const ids = [...new Set(shifts.map((s) => s.personId))].filter((id) => !names[id]);
    if (!ids.length || !isSupabaseConfigured) return;
    supabase.from('people').select('id, first_name, last_name').in('id', ids).then(({ data }) => {
      setNames((cur) => {
        const next = { ...cur };
        for (const p of data ?? []) next[p.id] = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Unnamed';
        return next;
      });
    });
  }, [shifts, names]);

  const nameOf = (id: string) => names[id] ?? '…';
  const stormWindow = storm?.dispatchedAt ? { start: storm.dispatchedAt, end: storm.status === 'ended' ? storm.endedAt : undefined } : undefined;
  const filtered = filterShifts(shifts, {
    personId: personId ?? undefined,
    ...(storm?.dispatchedAt ? { stormId: storm.id, includeUntagged, window: stormWindow } : { fromDay: days.fromDay, toDay: days.toDay }),
  });
  const untaggedCount = stormWindow ? countUntaggedDuring(shifts, stormWindow, personId ?? undefined) : 0;
  const taggedCount = storm ? filtered.filter((s) => s.stormId === storm.id).length : 0;
  const reviewCount = filtered.filter((s) => isShortShift(s)).length;
  const shown = onlyReview ? filtered.filter((s) => isShortShift(s)) : filtered;
  const groups = groupByWorkerDay(shown, nameOf);
  const totalMs = shown.reduce((t, s) => t + shiftMs(s), 0);

  /** Uses the end time the employee gave for a shift they never clocked out of. Their original clock-in stays on record; this adds a correction. */
  function acceptClaimedTime(s: SnowShift) {
    const who = names[s.personId] ?? 'this person';
    confirmAction(`Use ${who}'s time?`, `They say they stopped ${s.claimedOutAt ? formatClock(s.claimedOutAt) : ''}. This adds a correction; the original stays on record.`, 'Use it', async () => {
      const res = await correctShift(s.id, s.clockInAt, s.claimedOutAt ?? null, 'Used the time the employee gave');
      if (!res.ok) showMessage("Couldn't save the correction", res.error);
      reload();
    });
  }

  function clockOutNow(s: SnowShift) {
    const who = names[s.personId] ?? 'this person';
    confirmAction(`Clock out ${who} now?`, 'Their original clock-in stays on record; this adds a correction.', 'Clock out', async () => {
      const res = await correctShift(s.id, s.clockInAt, new Date().toISOString(), 'Clocked out by the owner');
      if (!res.ok) showMessage("Couldn't clock them out", res.error);
      reload();
    });
  }

  const workerOptions = [
    { key: 'all', label: 'All workers' },
    ...Object.entries(names).sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => ({ key: id, label: n })),
  ];
  const stormOptions = [{ key: 'none', label: 'Any time' }, ...storms.map((s) => ({ key: s.id, label: s.name }))];

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader title="Snow hours" subtitle={storm ? `${storm.name} · shifts tagged to this storm` : `${dayLabel(days.fromDay)} – ${dayLabel(days.toDay)}`} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['2xl'] }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
      >
        {error ? <InlineNotice icon="alert-circle" tone="error" text={error} style={{ marginBottom: spacing.md }} /> : null}

        <CollapsibleFilters
          groups={[
            { key: 'dates', label: 'Dates', options: RANGES, selected: range, onSelect: (k) => { setRange(k as typeof range); setStormId(null); }, defaultKey: 'this_week' },
            { key: 'storm', label: 'Storm', options: stormOptions, selected: stormId ?? 'none', onSelect: (k) => setStormId(k === 'none' ? null : k), defaultKey: 'none' },
            { key: 'worker', label: 'Worker', options: workerOptions, selected: personId ?? 'all', onSelect: (k) => setPersonId(k === 'all' ? null : k), defaultKey: 'all' },
          ]}
        />
        {storm ? (
          <View style={{ marginTop: spacing.sm, marginHorizontal: spacing.sm, gap: spacing.xs }}>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
              A clock-in is tagged with a storm automatically when the worker has exactly one active route. These are the shifts tagged to this storm.
            </Text>
            {untaggedCount > 0 ? (
              <Pressable onPress={() => setIncludeUntagged(!includeUntagged)} accessibilityRole="button" accessibilityState={{ checked: includeUntagged }}>
                <Text style={[typeScale.caption, { color: colors.primary }]}>
                  {taggedCount === 0 && !includeUntagged ? 'No shifts are tagged to this storm yet. ' : ''}
                  {untaggedCount} untagged {untaggedCount === 1 ? 'shift' : 'shifts'} overlapped this storm's time (no route, or more than one, when they clocked in). {includeUntagged ? 'Hide them' : 'Include them'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {loading ? <LoadingSpinner /> : (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface, marginTop: spacing.lg }]}>
              <Text style={[typeScale.overline, { color: colors.textSecondary }]}>TOTAL</Text>
              <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>{formatHours(msToHours(totalMs))}</Text>
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
                {shown.length} {shown.length === 1 ? 'shift' : 'shifts'} · {groups.length} {groups.length === 1 ? 'worker' : 'workers'}
              </Text>
              {reviewCount > 0 ? (
                <Pressable onPress={() => setOnlyReview(!onlyReview)} style={styles.reviewRow} accessibilityRole="button">
                  <Icon name="alert-triangle" size={16} color={colors.warning} />
                  <Text style={[typeScale.labelLarge, { color: colors.warning, flex: 1 }]}>
                    {reviewCount} short {reviewCount === 1 ? 'shift' : 'shifts'} to review (under {SHORT_SHIFT_MINUTES} min)
                  </Text>
                  <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{onlyReview ? 'Show all' : 'Show only these'}</Text>
                </Pressable>
              ) : null}
            </View>

            {groups.length === 0 ? (
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, margin: spacing.lg }]}>No shifts match these filters.</Text>
            ) : groups.map((w) => (
              <View key={w.personId} style={{ marginTop: spacing.xl }}>
                <View style={styles.workerHeader}>
                  <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flex: 1 }]}>{w.name}</Text>
                  {w.needsReview > 0 ? <Icon name="alert-triangle" size={16} color={colors.warning} /> : null}
                  <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{formatHours(msToHours(w.ms))}</Text>
                </View>
                <View style={[styles.group, { backgroundColor: colors.surface }]}>
                  {w.days.map((d, i) => {
                    const key = `${w.personId}:${d.dayKey}`;
                    const open = openDays[key] ?? d.needsReview > 0;
                    return (
                      <View key={key} style={i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight } : undefined}>
                        <Pressable
                          onPress={() => setOpenDays((cur) => ({ ...cur, [key]: !open }))}
                          style={styles.row}
                          accessibilityRole="button"
                          accessibilityState={{ expanded: open }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{dayLabel(d.dayKey)}</Text>
                            <Text style={[typeScale.caption, { color: d.needsReview ? colors.warning : colors.textSecondary }]}>
                              {d.shifts.length} {d.shifts.length === 1 ? 'shift' : 'shifts'}{d.needsReview ? ` · ${d.needsReview} to review` : ''}
                            </Text>
                          </View>
                          <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{formatHours(msToHours(d.ms))}</Text>
                          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
                        </Pressable>
                        {open ? d.shifts.map((s) => (
                          <ShiftRow
                            key={s.id}
                            s={s}
                            first={false}
                            flag={isShortShift(s) ? `Under ${SHORT_SHIFT_MINUTES} min. Check whether this was a mistake.` : undefined}
                            action={(
                              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                                <Button title="Correct times" size="sm" variant="secondary" onPress={() => setEditing(s)} />
                                {!s.originalOut ? <Button title="Clock out now" size="sm" variant="secondary" onPress={() => clockOutNow(s)} /> : null}
                                {s.flaggedAt && !s.corrected && s.claimedOutAt ? <Button title="Use their time" size="sm" variant="secondary" onPress={() => acceptClaimedTime(s)} /> : null}
                              </View>
                            )}
                          />
                        )) : null}
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
      <ShiftCorrectionSheet
        shift={editing}
        who={editing ? names[editing.personId] : undefined}
        onClose={() => setEditing(null)}
        onSaved={reload}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { borderRadius: radius.lg, padding: spacing.lg },
  label: { marginLeft: spacing.sm, marginBottom: spacing.sm, marginTop: spacing.xl },
  filterLabel: { marginLeft: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  workerHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginLeft: spacing.sm, marginRight: spacing.sm, marginBottom: spacing.sm },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  group: { borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 52 },
});
