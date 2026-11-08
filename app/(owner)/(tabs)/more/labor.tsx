import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, Platform } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { db, useDb } from '@/data/store';
import { addWorkday, loadAlerts, decideSkip, resolveAlert, type LaborAlert, type LaborSkip, type Result } from '@/data/timeTracking';
import { TimeEditSheet } from '@/components/time/TimeEditSheet';
import { FormSheet } from '@/components/materials/FormSheet';
import { useLabor } from '@/hooks/useLabor';
import { dayRows } from '@/lib/laborReports';
import { durationText, hoursText } from '@/lib/timeCalc';
import { todayKey } from '@/lib/ids';
import { Card, DayBar, Empty, LaborScreen, NotInstalled, Stat, StatePill, fmtClock, fmtDayLong } from '@/components/time/LaborBits';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

function say(title: string, message: string) {
  if (Platform.OS === 'web') (globalThis as { alert?: (m: string) => void }).alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

function skipLabel(s: LaborSkip): string {
  if (s.maintenanceStopId) return db.maintenance.stopById[s.maintenanceStopId]?.property?.name ?? 'a maintenance stop';
  const a = db.assignments.find((x) => x.id === s.assignmentId);
  return a?.project?.name ?? 'a job';
}

/** Hours & Labor: today's workforce at a glance. Everything links down to the record behind it. */
export default function LaborOverviewScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  useDb();
  const [date, setDate] = useState(todayKey());
  const L = useLabor(date, date);
  const [alerts, setAlerts] = useState<LaborAlert[]>([]);
  // Adding a workday the employee forgot to clock in for.
  const [pickWho, setPickWho] = useState(false);
  const [addFor, setAddFor] = useState<string | null>(null);
  const refreshAlerts = useCallback(async () => { const r = await loadAlerts(); if (r.ok) setAlerts(r.data); }, []);
  useFocusEffect(useCallback(() => { refreshAlerts(); }, [refreshAlerts]));

  const now = Date.now();
  const rows = useMemo(() => (L.snapshot ? dayRows(L.snapshot, now) : []), [L.snapshot, Math.floor(now / 30000)]);
  const pendingSkips = (L.snapshot?.skips ?? []).filter((s) => s.status === 'pending');
  // Still clocked in from an earlier day (almost always a forgotten clock-out): never counted in today's totals, but never hidden either.
  const stale = L.snapshot?.staleOpen ?? [];
  const clockedIn = rows.filter((r) => !r.workday.clockOutAt);
  const onProperty = clockedIn.filter((r) => r.currentLabel);
  const ready = rows.filter((r) => r.state === 'ready');
  const needs = rows.filter((r) => r.state === 'needs_correction' || r.state === 'needs_end_time' || r.state === 'reapproval');
  const approved = rows.filter((r) => r.state === 'approved');
  const visitsToday = L.snapshot?.visits.filter((v) => v.visitDate === date) ?? [];

  const refreshAll = async () => { await Promise.all([L.reload(), refreshAlerts()]); };
  async function decide(s: LaborSkip, approve: boolean) {
    const r = await decideSkip(s.id, approve);
    if (!r.ok) say("Couldn't save your decision", r.error);
    refreshAll();
  }
  const openDay = (workdayId: string) => router.push({ pathname: '/(owner)/more/labor-day', params: { id: workdayId } } as never);

  return (
    <LaborScreen title="Hours & Labor" subtitle={fmtDayLong(date)} loading={L.loading && !L.snapshot} onRefresh={refreshAll}
      right={<Pressable onPress={() => router.push('/(owner)/more/labor-settings' as never)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hours and labor settings"><Icon name="settings" size={22} color={colors.textPrimary} /></Pressable>}>
      {L.notInstalled ? <NotInstalled /> : null}
      {L.error ? <Card><Text style={[typeScale.bodyMedium, { color: colors.error }]}>{L.error}</Text></Card> : null}
      <DayBar dateKey={date} onChange={setDate} />

      {!L.notInstalled ? (
        <>
          <Card>
            <View style={styles.statRow}>
              <Stat label="Clocked in now" value={String(clockedIn.length)} sub={`${onProperty.length} at a property`} />
              <Stat label="Workdays" value={String(rows.length)} sub={`${visitsToday.length} property visits`} />
            </View>
            <View style={[styles.statRow, { marginTop: spacing.md }]}>
              <Stat label="Ready for review" value={String(ready.length)} tone={ready.length ? 'warn' : undefined} />
              <Stat label="Needs correction" value={String(needs.length)} tone={needs.length ? 'warn' : undefined} />
              <Stat label="Approved" value={String(approved.length)} tone="good" />
            </View>
          </Card>

          {pendingSkips.length + alerts.length + stale.length > 0 ? (
            <Card title="NEEDS ATTENTION">
              {pendingSkips.map((s) => (
                <View key={s.id} style={[styles.alertRow, { borderColor: colors.borderLight }]}>
                  <Icon name="skip-forward" size={18} color={colors.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>Skip requested: {skipLabel(s)}</Text>
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{L.snapshot?.names[s.requestedBy] ?? 'A worker'}: {s.reason}</Text>
                    <View style={styles.btnRow}>
                      <Pressable onPress={() => decide(s, true)} style={[styles.smallBtn, { backgroundColor: colors.primary }]} accessibilityRole="button"><Text style={[typeScale.labelSmall, { color: '#FFFFFF' }]}>Approve skip</Text></Pressable>
                      <Pressable onPress={() => decide(s, false)} style={[styles.smallBtn, { backgroundColor: colors.backgroundTertiary }]} accessibilityRole="button"><Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>Deny</Text></Pressable>
                    </View>
                  </View>
                </View>
              ))}
              {stale.map((w) => (
                <Pressable key={w.id} onPress={() => openDay(w.id)} style={[styles.alertRow, { borderColor: colors.borderLight }]} accessibilityRole="button">
                  <Icon name="alert-circle" size={18} color={colors.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>Still clocked in: {L.snapshot?.names[w.personId] ?? 'An employee'}</Text>
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Clocked in {fmtDayLong(w.workDate)} at {fmtClock(w.clockInAt)} and never clocked out. Open the day to set the clock-out.</Text>
                  </View>
                  <Icon name="chevron-right" size={18} color={colors.textTertiary} />
                </Pressable>
              ))}
              {alerts.filter((a) => a.kind !== 'skip_request').map((a) => (
                <Pressable key={a.id}
                  onPress={() => (a.workdayId ? openDay(a.workdayId) : a.visitId ? router.push({ pathname: '/(owner)/more/labor-visit', params: { id: a.visitId } } as never) : undefined)}
                  style={[styles.alertRow, { borderColor: colors.borderLight }]} accessibilityRole="button">
                  <Icon name="alert-circle" size={18} color={colors.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{a.title}</Text>
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{a.detail}</Text>
                  </View>
                  <Pressable onPress={async () => { await resolveAlert(a.id); refreshAlerts(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss"><Icon name="check" size={18} color={colors.textTertiary} /></Pressable>
                </Pressable>
              ))}
            </Card>
          ) : null}

          <Card title="EMPLOYEES" right={<Pressable onPress={() => setPickWho(true)} hitSlop={8} accessibilityRole="button"><Text style={[typeScale.labelSmall, { color: colors.primary }]}>Add missed workday</Text></Pressable>}>
            {rows.length === 0 ? <Empty icon="clock" text="Nobody has clocked in on this day." /> : rows.map((r, i) => {
              const person = db.people[r.workday.personId];
              return (
                <Pressable key={r.workday.id} onPress={() => openDay(r.workday.id)} accessibilityRole="button"
                  style={[styles.empRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}>
                  <Avatar firstName={person?.firstName ?? r.personName} lastName={person?.lastName ?? ''} size={36} uri={person?.avatarUrl} />
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{r.personName}</Text>
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                      {fmtClock(r.workday.clockInAt)} – {r.workday.clockOutAt ? fmtClock(r.workday.clockOutAt) : 'now'} · Net payable {durationText(r.summary.netMs)}
                    </Text>
                    {r.currentLabel ? <Text style={[typeScale.caption, { color: colors.primary }]}>At {r.currentLabel}</Text> : !r.workday.clockOutAt ? <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Clocked in, not at a property</Text> : null}
                    {r.problems[0] ? <Text style={[typeScale.caption, { color: colors.warning }]}>{r.problems[0].message}</Text> : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <StatePill state={r.state} />
                    <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{hoursText(r.summary.netMs)} h</Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>

          <Card title="MORE">
            {[
              { icon: 'check-square' as const, label: 'Payroll review', sub: 'Approve each day', to: '/(owner)/more/labor-review' },
              { icon: 'calendar' as const, label: 'Weekly summary', sub: 'Hours, overtime and cost by employee', to: '/(owner)/more/labor-week' },
              { icon: 'map-pin' as const, label: 'Property & project history', sub: 'Every visit, averages and labor cost', to: '/(owner)/more/labor-properties' },
            ].map((x, i) => (
              <Pressable key={x.label} onPress={() => router.push(x.to as never)} accessibilityRole="button"
                style={[styles.empRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}>
                <Icon name={x.icon} size={20} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{x.label}</Text>
                  <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{x.sub}</Text>
                </View>
                <Icon name="chevron-right" size={18} color={colors.textTertiary} />
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}
      <FormSheet visible={pickWho} title="Who forgot to clock in?" onClose={() => setPickWho(false)}>
        {db.members.filter((m) => m.role === 'worker' && m.status === 'active').map((m) => {
          const p = db.people[m.personId];
          return (
            <Pressable key={m.personId} onPress={() => { setPickWho(false); setAddFor(m.personId); }} style={[styles.pickRow, { borderColor: colors.borderLight }]} accessibilityRole="button">
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>{p ? `${p.firstName} ${p.lastName}` : 'Employee'}</Text>
              <Icon name="chevron-right" size={18} color={colors.textTertiary} />
            </Pressable>
          );
        })}
      </FormSheet>
      {addFor ? (
        <TimeEditSheet visible title="Add a missed workday" description={`The workday on ${fmtDayLong(date)}. Set the real clock-in and clock-out; they are saved as your correction, with your reason.`}
          fields={[{ key: 'in', label: 'Clock-in', defaultDate: date }, { key: 'out', label: 'Clock-out', optional: true, defaultDate: date }]}
          onSave={async (v, reason): Promise<Result> => {
            if (!v.in) return { ok: false, error: 'Set the clock-in time.' };
            const r = await addWorkday(addFor, date, v.in, v.out ?? null, reason);
            if (r.ok) refreshAll();
            return r;
          }}
          onClose={() => setAddFor(null)} />
      ) : null}
    </LaborScreen>
  );
}

const styles = StyleSheet.create({
  statRow: { flexDirection: 'row', gap: spacing.md },
  alertRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm, alignItems: 'flex-start' },
  empRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, alignItems: 'center' },
  btnRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  smallBtn: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.full },
  pickRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth },
});
