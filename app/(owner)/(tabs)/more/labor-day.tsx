import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { db } from '@/data/store';
import {
  addBreak, addInterval, approveWorkday, editBreak, editInterval, editWorkday, findWorkday, loadAudit, loadTimeSettings, reopenWorkday, voidInterval,
  type LaborAudit, type LaborVisit, type Result,
} from '@/data/timeTracking';
import { useLabor } from '@/hooks/useLabor';
import { dayRows, dailyCsv, auditCsv } from '@/lib/laborReports';
import { buildTimeline, durationText, hoursText, intervalMs } from '@/lib/timeCalc';
import { shareCsv } from '@/lib/exportCsv';
import { Card, Empty, KV, LaborScreen, NotInstalled, StatePill, fmtClock, fmtDay, fmtDayLong, money } from '@/components/time/LaborBits';
import { TimeEditSheet, type TimeField } from '@/components/time/TimeEditSheet';
import { FormSheet } from '@/components/materials/FormSheet';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { w } from '@/config/brand';

type Sheet =
  | null
  | { kind: 'workday' }
  | { kind: 'interval'; id: string; start: string; end?: string }
  | { kind: 'void'; id: string }
  | { kind: 'pickVisit' }
  | { kind: 'addInterval'; visit: LaborVisit }
  | { kind: 'addBreak' }
  | { kind: 'editBreak'; id: string; start: string; end?: string }
  | { kind: 'reopen' };

function say(title: string, message: string) {
  if (Platform.OS === 'web') (globalThis as { alert?: (m: string) => void }).alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}
const sameInstant = (a?: Date | null, b?: string | null) => (a && b ? Math.abs(a.getTime() - new Date(b).getTime()) < 1000 : !a && !b);

/** One employee, one day: totals, timeline, every property time, corrections, approval and the full change history. */
export default function LaborDayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const [ref, setRef] = useState<{ personId: string; workDate: string } | null>(null);
  const [refError, setRefError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    findWorkday(id).then((r) => { if (!live) return; if (r.ok) setRef(r.data); else setRefError(r.error); });
    return () => { live = false; };
  }, [id]);

  const L = useLabor(ref?.workDate ?? '', ref?.workDate ?? '', ref?.personId);
  const [audit, setAudit] = useState<LaborAudit[]>([]);
  const [breaksPaidDefault, setBreaksPaidDefault] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);

  const reloadAll = async () => {
    await L.reload();
    const a = await loadAudit({ workdayId: id });
    if (a.ok) setAudit(a.data);
  };
  useEffect(() => { if (ref) reloadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ref?.personId, ref?.workDate]);
  useEffect(() => {
    if (!db.companyId) return;
    loadTimeSettings(db.companyId).then((r) => { if (r.ok) setBreaksPaidDefault(r.data.breaksPaid); });
  }, []);

  const now = Date.now();
  const row = useMemo(() => (L.snapshot ? dayRows(L.snapshot, now).find((r) => r.workday.id === id) : undefined), [L.snapshot, id, Math.floor(now / 15000)]);
  const dayVisits = (L.snapshot?.visits ?? []).filter((v) => v.visitDate === ref?.workDate);
  const person = row ? db.people[row.workday.personId] : undefined;
  const timeline = useMemo(() => (row ? buildTimeline(
    { id: row.workday.id, personId: row.workday.personId, workDate: row.workday.workDate, clockInAt: row.workday.clockInAt, clockOutAt: row.workday.clockOutAt ?? null, status: row.workday.status },
    row.breaks.map((b) => ({ id: b.id, startedAt: b.startedAt, endedAt: b.endedAt ?? null, paid: b.paid })),
    row.intervals.map((i) => ({ ...i, endedAt: i.endedAt ?? null })), now) : []), [row, Math.floor(now / 15000)]);

  const done = async (r: Result) => { if (!r.ok) { say("Couldn't save", r.error); return r; } await reloadAll(); return r; };
  const wd = row?.workday;
  const sumPropertyMs = row?.propertyLaborMs ?? 0;
  const betweenMs = row ? Math.max(0, row.summary.grossMs - row.summary.recordedBreakMs - sumPropertyMs) : 0;
  const canApprove = !!row && (row.state === 'ready' || row.state === 'reapproval');

  async function onApprove() {
    if (!wd) return;
    const r = await approveWorkday(wd.id);
    if (!r.ok) say("Can't approve yet", r.error);
    await reloadAll();
  }
  async function onExport() {
    if (!row) return;
    try { await shareCsv(`hours-${row.personName}-${row.workday.workDate}`, dailyCsv([row])); }
    catch (e) { say("Couldn't export", e instanceof Error ? e.message : 'Try again.'); }
  }
  async function onExportAudit() {
    try {
      await shareCsv(`time-changes-${row?.personName ?? 'employee'}-${wd?.workDate ?? ''}`, auditCsv(audit.map((a) => ({
        createdAt: a.createdAt, entity: a.entity, action: a.action, field: a.field, oldValue: a.oldValue, newValue: a.newValue, reason: a.reason,
        actor: a.actorId ? `${db.people[a.actorId]?.firstName ?? ''} ${db.people[a.actorId]?.lastName ?? ''}`.trim() : '', person: row?.personName, wasApproved: a.wasApproved,
      }))));
    } catch (e) { say("Couldn't export", e instanceof Error ? e.message : 'Try again.'); }
  }

  // ── Sheets ────────────────────────────────────────────────────────────────
  const dateKey = ref?.workDate;
  let sheetNode: React.ReactNode = null;
  if (sheet?.kind === 'workday' && wd) {
    const fields: TimeField[] = [
      { key: 'in', label: 'Clock-in', value: wd.clockInAt },
      { key: 'out', label: 'Clock-out', value: wd.clockOutAt, optional: !wd.clockOutAt, defaultDate: dateKey },
    ];
    sheetNode = (
      <TimeEditSheet visible title="Correct the workday" fields={fields} description="Change a clock time. Everything recorded before stays in the history."
        onSave={async (v, reason) => {
          const nin = sameInstant(v.in, wd.clockInAt) ? null : v.in;
          const nout = sameInstant(v.out, wd.clockOutAt ?? null) ? null : v.out;
          if (!nin && !nout) return { ok: true } as Result;
          return done(await editWorkday(wd.id, nin, nout, reason));
        }}
        onClose={() => setSheet(null)} />
    );
  } else if (sheet?.kind === 'interval') {
    const s = sheet;
    sheetNode = (
      <TimeEditSheet visible title={w('Correct the job site time')} fields={[{ key: 's', label: 'Started', value: s.start }, { key: 'e', label: 'Ended', value: s.end, optional: !s.end, defaultDate: dateKey }]}
        description={s.end ? undefined : 'This timer is still running. Set the time it ended to stop it.'}
        onSave={async (v, reason) => {
          const ns = sameInstant(v.s, s.start) ? null : v.s;
          const ne = sameInstant(v.e, s.end ?? null) ? null : v.e;
          if (!ns && !ne) return { ok: true } as Result;
          return done(await editInterval(s.id, ns, ne, reason));
        }}
        onClose={() => setSheet(null)} />
    );
  } else if (sheet?.kind === 'void') {
    const s = sheet;
    sheetNode = <TimeEditSheet visible title={w('Remove this job site time')} fields={[]} saveLabel="Remove" description="It stays in the history, but no longer counts toward labor or pay." onSave={async (_v, reason) => done(await voidInterval(s.id, reason))} onClose={() => setSheet(null)} />;
  } else if (sheet?.kind === 'reopen' && wd) {
    sheetNode = <TimeEditSheet visible title="Reopen this day" fields={[]} saveLabel="Reopen" description="The day goes back to needing approval. The earlier approval stays in the history." onSave={async (_v, reason) => done(await reopenWorkday(wd.id, reason))} onClose={() => setSheet(null)} />;
  } else if (sheet?.kind === 'addBreak' && wd) {
    sheetNode = (
      <TimeEditSheet visible title="Add a break" fields={[{ key: 's', label: 'Break started', value: undefined, defaultDate: dateKey }, { key: 'e', label: 'Break ended', value: undefined, defaultDate: dateKey }]}
        description={breaksPaidDefault ? 'Counts as paid time (per your break setting).' : 'Counts as unpaid and is deducted from payable hours (per your break setting).'}
        onSave={async (v, reason) => (v.s && v.e ? done(await addBreak(wd.id, v.s, v.e, breaksPaidDefault, reason)) : ({ ok: false, error: 'Set both times.' } as Result))}
        onClose={() => setSheet(null)} />
    );
  } else if (sheet?.kind === 'editBreak') {
    const s = sheet;
    sheetNode = (
      <TimeEditSheet visible title="Correct the break" fields={[{ key: 's', label: 'Started', value: s.start }, { key: 'e', label: 'Ended', value: s.end, optional: !s.end, defaultDate: dateKey }]}
        onSave={async (v, reason) => {
          const ns = sameInstant(v.s, s.start) ? null : v.s;
          const ne = sameInstant(v.e, s.end ?? null) ? null : v.e;
          if (!ns && !ne) return { ok: true } as Result;
          return done(await editBreak(s.id, ns, ne, reason));
        }}
        onClose={() => setSheet(null)} />
    );
  } else if (sheet?.kind === 'pickVisit') {
    sheetNode = (
      <FormSheet visible title={w('Which job site?')} onClose={() => setSheet(null)}>
        {dayVisits.length === 0 ? <Empty icon="map-pin" text={w('No job site visits are recorded for this date yet.')} /> : dayVisits.map((v) => (
          <Pressable key={v.id} onPress={() => setSheet({ kind: 'addInterval', visit: v })} style={[styles.pickRow, { borderColor: colors.borderLight }]} accessibilityRole="button">
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>{v.label ?? w('Job site')}</Text>
            <Icon name="chevron-right" size={18} color={colors.textTertiary} />
          </Pressable>
        ))}
      </FormSheet>
    );
  } else if (sheet?.kind === 'addInterval' && wd) {
    const v = sheet.visit;
    sheetNode = (
      <TimeEditSheet visible title={`Add time at ${v.label ?? w('job site')}`} fields={[{ key: 's', label: 'Started', value: undefined, defaultDate: dateKey }, { key: 'e', label: 'Ended (leave empty to start a timer)', value: undefined, optional: true, defaultDate: dateKey }]}
        onSave={async (val, reason) => (val.s ? done(await addInterval(v.id, wd.personId, val.s, val.e ?? null, reason)) : ({ ok: false, error: 'Set the start time.' } as Result))}
        onClose={() => setSheet(null)} />
    );
  }

  const reviewProblems = (row?.problems ?? []).filter((p) => !(row?.state === 'needs_end_time' && /never clocked out/i.test(p.message)));

  return (
    <LaborScreen title={row?.personName ?? 'Workday'} subtitle={dateKey ? fmtDayLong(dateKey) : undefined} loading={(L.loading || !ref) && !row && !refError} onRefresh={reloadAll}>
      {L.notInstalled ? <NotInstalled /> : null}
      {refError || L.error ? <Card><Text style={[typeScale.bodyMedium, { color: colors.error }]}>{refError ?? L.error}</Text></Card> : null}
      {row && wd ? (
        <>
          <Card>
            <View style={styles.head}>
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{row.personName}</Text>
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{person?.email ?? ''}</Text>
              </View>
              <StatePill state={row.state} />
            </View>
            {wd.approvedAt ? <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>Approved {new Date(wd.approvedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{wd.status === 'reopened' ? ' (changed since, needs approval again)' : ''}</Text> : null}
            <View style={styles.btnRow}>
              {canApprove ? <Pressable onPress={onApprove} style={[styles.btn, { backgroundColor: colors.primary }]} accessibilityRole="button"><Icon name="check" size={16} color="#FFFFFF" /><Text style={[typeScale.labelSmall, { color: '#FFFFFF' }]}>Approve day</Text></Pressable> : null}
              {row.state === 'approved' ? <Pressable onPress={() => setSheet({ kind: 'reopen' })} style={[styles.btn, { backgroundColor: colors.backgroundTertiary }]} accessibilityRole="button"><Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>Reopen</Text></Pressable> : null}
              <Pressable onPress={onExport} style={[styles.btn, { backgroundColor: colors.backgroundTertiary }]} accessibilityRole="button"><Icon name="download" size={16} color={colors.textPrimary} /><Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>Export CSV</Text></Pressable>
            </View>
            {(row.state === 'needs_correction' || (row.state === 'in_progress' && row.problems.length)) ? <Text style={[typeScale.caption, { color: colors.warning, marginTop: spacing.sm }]}>Fix the items below before this day can be approved.</Text> : null}
          </Card>

          {row.state === 'needs_end_time' ? (
            <Card>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>Never clocked out</Text>
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                {wd.claimedOutAt
                  ? `${row.personName} says they stopped ${new Date(wd.claimedOutAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${wd.claimNote ? ` ("${wd.claimNote}")` : ''}.`
                  : wd.claimedAt ? `${row.personName} is not sure when they stopped.` : `${row.personName} has not answered yet.`}
                {' '}This day counts as zero hours until you set the real end time. The original clock-in is kept.
              </Text>
              <View style={styles.btnRow}>
                {wd.claimedOutAt ? (
                  <Pressable onPress={async () => { await done(await editWorkday(wd.id, null, wd.claimedOutAt!, 'Used the time the employee gave')); }} style={[styles.btn, { backgroundColor: colors.primary }]} accessibilityRole="button">
                    <Text style={[typeScale.labelLarge, { color: '#FFFFFF' }]}>Use their time</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => setSheet({ kind: 'workday' })} style={[styles.btn, { backgroundColor: colors.backgroundTertiary }]} accessibilityRole="button">
                  <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>Set the end time</Text>
                </Pressable>
              </View>
            </Card>
          ) : null}

          {reviewProblems.length ? (
            <Card title="NEEDS REVIEW">
              {reviewProblems.map((p, i) => <View key={i} style={styles.problem}><Icon name="alert-circle" size={16} color={colors.warning} /><Text style={[typeScale.bodyMedium, { color: colors.textPrimary, flex: 1 }]}>{p.message}</Text></View>)}
            </Card>
          ) : null}

          <Card title="HOURS">
            <KV label="Gross workday time" value={durationText(row.summary.grossMs)} hint="Clock-in to clock-out" />
            <KV label="Recorded breaks" value={durationText(row.summary.recordedBreakMs)} />
            <KV label="Break time deducted" value={durationText(row.summary.deductedBreakMs)} hint="Only unpaid breaks are deducted" />
            <KV label="Net payable time" value={`${durationText(row.summary.netMs)}  (${hoursText(row.summary.netMs)} h)`} bold />
            <KV label={w('Time at job sites')} value={durationText(sumPropertyMs)} hint="This employee's own time at visits" />
            <KV label="Time between visits and at the yard" value={durationText(betweenMs)} hint="Not confirmed as driving; the app can't tell" />
            <KV label="Hourly rate that applied" value={money(wd.hourlyRate)} />
            <KV label="Payable cost (straight time)" value={row.payableCost == null ? 'No rate set' : `$${row.payableCost.toFixed(2)}`} hint="The weekly view adds any overtime premium" />
            {wd.truckId ? <KV label="Truck" value={db.trucks.find((t) => t.id === wd.truckId)?.name ?? 'Truck'} /> : null}
          </Card>

          <Card title="TIMELINE" right={<View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Pressable onPress={() => setSheet({ kind: 'pickVisit' })} hitSlop={8} accessibilityRole="button"><Text style={[typeScale.labelSmall, { color: colors.primary }]}>{w('Add job site time')}</Text></Pressable>
            <Pressable onPress={() => setSheet({ kind: 'addBreak' })} hitSlop={8} accessibilityRole="button"><Text style={[typeScale.labelSmall, { color: colors.primary }]}>Add break</Text></Pressable>
          </View>}>
            {timeline.map((e, i) => {
              const iv = e.kind === 'visit' || e.kind === 'open' ? row.intervals.find((x) => x.id === e.refId) : undefined;
              const br = e.kind === 'break' ? row.breaks.find((x) => x.id === e.refId) : undefined;
              const tappable = e.kind === 'clock_in' || e.kind === 'clock_out' || !!iv || !!br;
              const onPress = () => {
                if (e.kind === 'clock_in' || e.kind === 'clock_out') setSheet({ kind: 'workday' });
                else if (iv) setSheet({ kind: 'interval', id: iv.id, start: iv.startedAt, end: iv.endedAt });
                else if (br) setSheet({ kind: 'editBreak', id: br.id, start: br.startedAt, end: br.endedAt });
              };
              const muted = e.kind === 'gap';
              return (
                <Pressable key={i} onPress={tappable ? onPress : undefined} disabled={!tappable} accessibilityRole={tappable ? 'button' : undefined}
                  style={[styles.tl, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}>
                  <Text style={[typeScale.labelSmall, { color: colors.textTertiary, width: 84 }]}>{fmtClock(e.startedAt)}{e.endedAt ? ` – ${fmtClock(e.endedAt)}` : e.kind === 'open' ? ' – now' : ''}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.bodyMedium, { color: muted ? colors.textTertiary : colors.textPrimary, fontStyle: muted ? 'italic' : 'normal' }]}>{e.label}</Text>
                    {e.ms > 0 || iv ? <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{iv ? `Labor ${durationText(intervalMs(iv, now))}${iv.billable ? '' : ' · non-billable'}${iv.hourlyRate != null ? ` · ${money(iv.hourlyRate)}/h` : ''}` : durationText(e.ms)}</Text> : null}
                  </View>
                  {iv ? (
                    <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
                      <Pressable onPress={() => router.push({ pathname: '/(owner)/more/labor-visit', params: { id: iv.visitId } } as never)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open the visit"><Icon name="external-link" size={16} color={colors.textTertiary} /></Pressable>
                      <Pressable onPress={() => setSheet({ kind: 'void', id: iv.id })} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove this time"><Icon name="trash-2" size={16} color={colors.textTertiary} /></Pressable>
                    </View>
                  ) : tappable ? <Icon name="edit-2" size={14} color={colors.textTertiary} /> : null}
                </Pressable>
              );
            })}
            {row.intervals.some((i) => i.status === 'void') ? <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.sm }]}>{row.intervals.filter((i) => i.status === 'void').length} removed time(s) are not shown; see the history below.</Text> : null}
          </Card>

          <Card title="CHANGE HISTORY" right={audit.length ? <Pressable onPress={onExportAudit} hitSlop={8} accessibilityRole="button"><Text style={[typeScale.labelSmall, { color: colors.primary }]}>Export</Text></Pressable> : undefined}>
            {audit.length === 0 ? <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>No corrections or approvals yet.</Text> : audit.map((a, i) => {
              const who = a.actorId ? `${db.people[a.actorId]?.firstName ?? ''} ${db.people[a.actorId]?.lastName ?? ''}`.trim() || 'Someone' : 'System';
              const fmt = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? `${fmtDay(v.slice(0, 10))} ${fmtClock(v)}` : v == null ? 'nothing' : typeof v === 'object' ? JSON.stringify(v) : String(v));
              return (
                <View key={a.id} style={[styles.tl, { flexDirection: 'column', alignItems: 'flex-start' }, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}>
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
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  btnRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 9, borderRadius: radius.full },
  problem: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 4, alignItems: 'flex-start' },
  tl: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  pickRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth },
});
