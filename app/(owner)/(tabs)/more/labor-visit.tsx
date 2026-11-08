import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { db } from '@/data/store';
import { addInterval, editInterval, loadAudit, loadVisitDetail, setVisitBillable, voidInterval, type LaborAudit, type Result, type VisitDetail } from '@/data/timeTracking';
import { visitRows, visitsCsv } from '@/lib/laborReports';
import { compareToTarget, durationText, hoursText, intervalMs } from '@/lib/timeCalc';
import { shareCsv } from '@/lib/exportCsv';
import { Card, Empty, KV, LaborScreen, fmtClock, fmtDay, money } from '@/components/time/LaborBits';
import { TimeEditSheet } from '@/components/time/TimeEditSheet';
import { FormSheet } from '@/components/materials/FormSheet';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

type Sheet = null | { kind: 'interval'; id: string; start: string; end?: string } | { kind: 'void'; id: string } | { kind: 'billable' } | { kind: 'pickEmployee' } | { kind: 'add'; personId: string };

function say(title: string, message: string) {
  if (Platform.OS === 'web') (globalThis as { alert?: (m: string) => void }).alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}
const sameInstant = (a?: Date | null, b?: string | null) => (a && b ? Math.abs(a.getTime() - new Date(b).getTime()) < 1000 : !a && !b);

/** One property visit: how long the visit took, each employee's own time, labor cost, and every correction. */
export default function LaborVisitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const [detail, setDetail] = useState<VisitDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<LaborAudit[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);

  const load = async () => {
    const d = await loadVisitDetail(id);
    if (d.ok) { setDetail(d.data); setError(null); } else setError(d.error);
    const a = await loadAudit({ visitId: id });
    if (a.ok) setAudit(a.data);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const now = Date.now();
  const row = useMemo(() => (detail ? visitRows([{ id: detail.visit.id, label: detail.visit.label, status: detail.visit.status, billable: detail.visit.billable, visitDate: detail.visit.visitDate, source: detail.visit.source, targetMinutes: detail.visit.targetMinutes }],
    detail.intervals, detail.names, now)[0] : undefined), [detail, Math.floor(now / 15000)]);
  const done = async (r: Result) => { if (!r.ok) { say("Couldn't save", r.error); return r; } await load(); return r; };
  const target = row?.elapsedMs != null ? compareToTarget(row.elapsedMs, row.targetMinutes) : null;
  const workers = db.members.filter((m) => m.role === 'worker' && m.status === 'active');

  let sheetNode: React.ReactNode = null;
  if (sheet?.kind === 'interval') {
    const s = sheet;
    sheetNode = <TimeEditSheet visible title="Correct this employee's time" fields={[{ key: 's', label: 'Started', value: s.start }, { key: 'e', label: 'Ended', value: s.end, optional: !s.end, defaultDate: detail?.visit.visitDate }]}
      description={s.end ? undefined : 'This timer is still running. Set the time it ended to stop it.'}
      onSave={async (v, reason) => { const ns = sameInstant(v.s, s.start) ? null : v.s; const ne = sameInstant(v.e, s.end ?? null) ? null : v.e; if (!ns && !ne) return { ok: true } as Result; return done(await editInterval(s.id, ns, ne, reason)); }}
      onClose={() => setSheet(null)} />;
  } else if (sheet?.kind === 'void') {
    const s = sheet;
    sheetNode = <TimeEditSheet visible title="Remove this time" fields={[]} saveLabel="Remove" description="It stays in the history, but no longer counts toward labor or pay." onSave={async (_v, reason) => done(await voidInterval(s.id, reason))} onClose={() => setSheet(null)} />;
  } else if (sheet?.kind === 'billable' && detail) {
    const next = !detail.visit.billable;
    sheetNode = <TimeEditSheet visible title={next ? 'Mark as billable' : 'Mark as non-billable'} fields={[]} saveLabel="Save" description={next ? 'Counts toward the customer-job labor totals again.' : 'Employees\' hours and pay are not affected. This visit is left out of the billable labor totals (callbacks, rework, internal work).'} onSave={async (_v, reason) => done(await setVisitBillable(detail.visit.id, next, reason))} onClose={() => setSheet(null)} />;
  } else if (sheet?.kind === 'pickEmployee') {
    sheetNode = (
      <FormSheet visible title="Whose time?" onClose={() => setSheet(null)}>
        {workers.map((m) => {
          const p = db.people[m.personId];
          return (
            <Pressable key={m.personId} onPress={() => setSheet({ kind: 'add', personId: m.personId })} style={[styles.pickRow, { borderColor: colors.borderLight }]} accessibilityRole="button">
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>{p ? `${p.firstName} ${p.lastName}` : 'Employee'}</Text>
              <Icon name="chevron-right" size={18} color={colors.textTertiary} />
            </Pressable>
          );
        })}
      </FormSheet>
    );
  } else if (sheet?.kind === 'add' && detail) {
    const s = sheet;
    sheetNode = <TimeEditSheet visible title="Add time at this property" fields={[{ key: 's', label: 'Started', defaultDate: detail.visit.visitDate }, { key: 'e', label: 'Ended (leave empty to start a timer)', optional: true, defaultDate: detail.visit.visitDate }]}
      onSave={async (v, reason) => (v.s ? done(await addInterval(detail.visit.id, s.personId, v.s, v.e ?? null, reason)) : ({ ok: false, error: 'Set the start time.' } as Result))}
      onClose={() => setSheet(null)} />;
  }

  return (
    <LaborScreen title={detail?.visit.label ?? 'Property visit'} subtitle={detail ? fmtDay(detail.visit.visitDate) : undefined} loading={!detail && !error} onRefresh={load}
      right={row ? <Pressable onPress={async () => { try { await shareCsv(`visit-${detail?.visit.label ?? 'visit'}-${detail?.visit.visitDate}`, visitsCsv([row])); } catch (e) { say("Couldn't export", e instanceof Error ? e.message : 'Try again.'); } }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Export CSV"><Icon name="download" size={22} color={colors.textPrimary} /></Pressable> : undefined}>
      {error ? <Card><Text style={[typeScale.bodyMedium, { color: colors.error }]}>{error}</Text></Card> : null}
      {detail && row ? (
        <>
          <Card title="THE VISIT">
            <KV label="Status" value={detail.visit.status === 'completed' ? 'Completed' : detail.visit.status === 'void' ? 'Voided' : 'In progress'} />
            <KV label="Visit started" value={row.startedAt ? fmtClock(row.startedAt) : '–'} />
            <KV label="Visit ended" value={row.endedAt ? fmtClock(row.endedAt) : row.startedAt ? 'Still being worked' : '–'} />
            <KV label="Elapsed visit duration" value={row.elapsedMs == null ? '–' : durationText(row.elapsedMs)} hint="First start to last finish, however many employees" bold />
            <KV label="Crew labor" value={`${durationText(row.laborMs)}  (${hoursText(row.laborMs)} labor-hours)`} hint="Each employee's own time added together" bold />
            {row.targetMinutes ? <KV label="Time target" value={durationText(row.targetMinutes * 60000)} /> : null}
            {target ? <KV label="Actual vs target" value={`${durationText(Math.abs(target.diffMs))} ${target.over ? 'over' : 'under'}`} /> : null}
            <KV label="Labor cost" value={row.laborCost == null ? 'A rate is missing' : `$${row.laborCost.toFixed(2)}`} />
            <KV label="Billable labor cost" value={`$${row.billableCost?.toFixed(2) ?? '0.00'}`} />
            <KV label="Non-billable labor cost" value={`$${row.nonBillableCost?.toFixed(2) ?? '0.00'}`} />
            <Pressable onPress={() => setSheet({ kind: 'billable' })} style={[styles.btn, { backgroundColor: colors.backgroundTertiary }]} accessibilityRole="button">
              <Icon name={detail.visit.billable ? 'dollar-sign' : 'slash'} size={16} color={colors.textPrimary} />
              <Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>{detail.visit.billable ? 'Billable. Tap to mark non-billable' : 'Non-billable. Tap to mark billable'}</Text>
            </Pressable>
          </Card>

          <Card title="EACH EMPLOYEE'S TIME" right={<Pressable onPress={() => setSheet({ kind: 'pickEmployee' })} hitSlop={8} accessibilityRole="button"><Text style={[typeScale.labelSmall, { color: colors.primary }]}>Add time</Text></Pressable>}>
            {detail.intervals.length === 0 ? <Empty icon="users" text="Nobody has time recorded here yet." /> : detail.intervals.map((i, k) => (
              <View key={i.id} style={[styles.rowLine, k > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }, i.status === 'void' && { opacity: 0.5 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{detail.names[i.personId] ?? 'Employee'}{i.status === 'void' ? '  (removed)' : ''}</Text>
                  <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{fmtClock(i.startedAt)} – {i.endedAt ? fmtClock(i.endedAt) : 'running'} · {durationText(intervalMs(i, now))}{i.hourlyRate != null ? ` · ${money(i.hourlyRate)}/h` : ' · no rate'}</Text>
                </View>
                {i.status !== 'void' ? (
                  <View style={{ flexDirection: 'row', gap: spacing.md }}>
                    <Pressable onPress={() => setSheet({ kind: 'interval', id: i.id, start: i.startedAt, end: i.endedAt })} hitSlop={8} accessibilityRole="button" accessibilityLabel={i.endedAt ? 'Correct the time' : 'Stop the timer'}><Icon name={i.endedAt ? 'edit-2' : 'square'} size={16} color={colors.textTertiary} /></Pressable>
                    <Pressable onPress={() => setSheet({ kind: 'void', id: i.id })} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove this time"><Icon name="trash-2" size={16} color={colors.textTertiary} /></Pressable>
                    <Pressable onPress={() => router.push({ pathname: '/(owner)/more/labor-day', params: { id: i.workdayId } } as never)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open that employee's day"><Icon name="external-link" size={16} color={colors.textTertiary} /></Pressable>
                  </View>
                ) : null}
              </View>
            ))}
          </Card>

          <Card title="CHANGE HISTORY">
            {audit.length === 0 ? <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>No corrections yet.</Text> : audit.map((a, i) => {
              const who = a.actorId ? `${db.people[a.actorId]?.firstName ?? ''} ${db.people[a.actorId]?.lastName ?? ''}`.trim() || 'Someone' : 'System';
              const fmt = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? `${fmtDay(v.slice(0, 10))} ${fmtClock(v)}` : v == null ? 'nothing' : String(v));
              return (
                <View key={a.id} style={[styles.rowLine, { flexDirection: 'column', alignItems: 'flex-start' }, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}>
                  <Text style={[typeScale.bodyMedium, { color: colors.textPrimary }]}>{a.action.replace(/_/g, ' ')}{a.field ? ` · ${a.field.replace(/_/g, ' ')}` : ''}</Text>
                  {a.field ? <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{fmt(a.oldValue)}  →  {fmt(a.newValue)}</Text> : null}
                  {a.reason ? <Text style={[typeScale.caption, { color: colors.textSecondary }]}>“{a.reason}”</Text> : null}
                  <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{who} · {new Date(a.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{a.wasApproved ? ' · day was approved' : ''}</Text>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}
      {sheetNode}
    </LaborScreen>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.full, marginTop: spacing.md, alignSelf: 'flex-start' },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  pickRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth },
});
