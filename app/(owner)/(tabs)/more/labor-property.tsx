import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, Platform, Keyboard } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { Button, DateField, Input } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { db } from '@/data/store';
import { loadProjectEstimate, loadTargets, loadVisitHistory, saveProjectEstimate, saveTarget, type LaborInterval, type LaborVisit } from '@/data/timeTracking';
import { estimateComparison, projectTotals, visitRows, visitsCsv } from '@/lib/laborReports';
import { compareToTarget, durationText, hoursText, visitHistoryStats } from '@/lib/timeCalc';
import { shareCsv } from '@/lib/exportCsv';
import { todayKey } from '@/lib/ids';
import { Card, Chip, Empty, KV, LaborScreen, fmtDay, shiftDay } from '@/components/time/LaborBits';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

function say(title: string, message: string) {
  if (Platform.OS === 'web') (globalThis as { alert?: (m: string) => void }).alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/**
 * Every visit to one recurring property (or every day worked on one project): elapsed time vs crew labor kept apart, averages, the
 * owner's target, labor cost, and for a project the estimate vs the real labor-hours.
 */
export default function LaborPropertyScreen() {
  const { kind, id, name } = useLocalSearchParams<{ kind: 'maintenance_property' | 'project'; id: string; name?: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const isProject = kind === 'project';
  const [from, setFrom] = useState(shiftDay(todayKey(), -180));
  const [to, setTo] = useState(todayKey());
  const [billableOnly, setBillableOnly] = useState(false);
  const [data, setData] = useState<{ visits: LaborVisit[]; intervals: LaborInterval[]; names: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetText, setTargetText] = useState('');
  const [savedTarget, setSavedTarget] = useState<number | null>(null);
  const [estText, setEstText] = useState('');
  const [savedEst, setSavedEst] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await loadVisitHistory(kind, id, from, to);
    if (r.ok) { setData(r.data); setError(null); } else setError(r.error);
  }, [kind, id, from, to]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    loadTargets().then((r) => {
      if (!r.ok) return;
      const t = r.data.find((x) => (isProject ? x.projectId === id : x.maintenancePropertyId === id));
      setSavedTarget(t?.targetMinutes ?? null);
      setTargetText(t ? String(t.targetMinutes) : '');
    });
    if (isProject) loadProjectEstimate(id).then((r) => { if (r.ok) { setSavedEst(r.data?.laborHours ?? null); setEstText(r.data ? String(r.data.laborHours) : ''); } });
  }, [id, isProject]);

  const now = Date.now();
  const rows = useMemo(() => (data ? visitRows(data.visits.map((v) => ({ id: v.id, label: v.label, status: v.status, billable: v.billable, visitDate: v.visitDate, source: v.source, targetMinutes: v.targetMinutes })), data.intervals, data.names, now) : []), [data, Math.floor(now / 30000)]);
  const stats = visitHistoryStats(rows, billableOnly);
  const totals = data ? projectTotals(rows, data.intervals, data.names, now) : null;
  const est = totals && savedEst ? estimateComparison(totals.laborMs, savedEst) : null;
  const avgVsTarget = stats.averageElapsedMs != null && savedTarget ? compareToTarget(stats.averageElapsedMs, savedTarget) : null;

  async function saveTargetMinutes() {
    const n = targetText.trim() === '' ? null : Number(targetText);
    if (n != null && !(n >= 5 && n <= 1440)) { say('Check the target', 'A target is a number of minutes between 5 and 1440.'); return; }
    const r = await saveTarget(db.companyId ?? '', kind, id, n, db.personId);
    if (!r.ok) say("Couldn't save", r.error); else { Keyboard.dismiss(); setSavedTarget(n); say(n == null ? 'Target removed' : 'Target saved', n == null ? 'No alert will use a target here.' : `New visits will use ${n} minutes. Visits already recorded keep the target they started with.`); }
  }
  async function saveEstimate() {
    const n = estText.trim() === '' ? null : Number(estText);
    if (n != null && !(n > 0)) { say('Check the estimate', 'Enter the estimated labor-hours (the total person-hours).'); return; }
    const r = await saveProjectEstimate(db.companyId ?? '', id, n, null, db.personId);
    if (!r.ok) say("Couldn't save", r.error); else { Keyboard.dismiss(); setSavedEst(n); }
  }

  return (
    <LaborScreen title={name ?? (isProject ? 'Project' : 'Property')} subtitle={isProject ? 'Labor by visit' : 'Visit history'} loading={!data && !error} onRefresh={load}
      right={rows.length ? <Pressable onPress={async () => { try { await shareCsv(`visits-${name ?? id}`, visitsCsv(rows)); } catch (e) { say("Couldn't export", e instanceof Error ? e.message : 'Try again.'); } }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Export CSV"><Icon name="download" size={22} color={colors.textPrimary} /></Pressable> : undefined}>
      {error ? <Card><Text style={[typeScale.bodyMedium, { color: colors.error }]}>{error}</Text></Card> : null}
      <Card>
        <View style={styles.range}>
          <View style={{ flex: 1 }}><DateField label="From" value={from} onChange={setFrom} maximumDate={to} /></View>
          <View style={{ flex: 1 }}><DateField label="To" value={to} onChange={setTo} minimumDate={from} /></View>
        </View>
        <View style={styles.chips}>
          <Chip label="All visits" on={!billableOnly} onPress={() => setBillableOnly(false)} />
          <Chip label="Billable only" on={billableOnly} onPress={() => setBillableOnly(true)} />
        </View>
      </Card>

      <Card title="AVERAGES">
        <KV label="Completed visits counted" value={String(stats.count)} hint="In-progress, voided and skipped visits are left out" />
        <KV label="Average elapsed visit duration" value={stats.averageElapsedMs == null ? '–' : durationText(stats.averageElapsedMs)} hint="How long a visit takes, start to finish" bold />
        <KV label="Average crew labor" value={stats.averageLaborMs == null ? '–' : `${hoursText(stats.averageLaborMs)} labor-hours`} hint="All employees' time added together" bold />
        {avgVsTarget ? <KV label="Average vs your target" value={`${durationText(Math.abs(avgVsTarget.diffMs))} ${avgVsTarget.over ? 'over' : 'under'}`} /> : null}
      </Card>

      <Card title="TIME TARGET FOR ONE VISIT">
        <Text style={[typeScale.caption, { color: colors.textSecondary, marginBottom: spacing.sm }]}>The owner's expected visit length in minutes. It is never shown to workers.</Text>
        <Input label="Target (minutes)" value={targetText} onChangeText={setTargetText} keyboardType="number-pad" placeholder="e.g. 120" />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button title="Save target" size="sm" onPress={saveTargetMinutes} />
          {savedTarget != null ? <Button title="Remove" size="sm" variant="ghost" onPress={() => { setTargetText(''); saveTarget(db.companyId ?? '', kind, id, null, db.personId).then((r) => { if (r.ok) setSavedTarget(null); else say("Couldn't remove", r.error); }); }} /> : null}
        </View>
      </Card>

      {isProject && totals ? (
        <>
          <Card title="PROJECT LABOR (ALL DAYS)">
            <KV label="Work visits" value={String(totals.visits)} hint={totals.firstDate ? `${fmtDay(totals.firstDate)} to ${fmtDay(totals.lastDate ?? totals.firstDate)}` : undefined} />
            <KV label="Total crew labor" value={`${hoursText(totals.laborMs)} labor-hours`} bold />
            <KV label="Billable labor" value={`${hoursText(totals.billableLaborMs)} h`} />
            <KV label="Non-billable labor" value={`${hoursText(totals.nonBillableLaborMs)} h`} />
            <KV label="Actual labor cost" value={`$${totals.cost.toFixed(2)}`} bold />
            {totals.byEmployee.map((e) => <KV key={e.personId} label={e.name} value={`${hoursText(e.ms)} h · $${e.cost.toFixed(2)}`} />)}
          </Card>
          <Card title="ESTIMATE VS ACTUAL">
            <Text style={[typeScale.caption, { color: colors.textSecondary, marginBottom: spacing.sm }]}>Estimated total labor-hours (person-hours), compared with the actual crew labor above.</Text>
            <Input label="Estimated labor-hours" value={estText} onChangeText={setEstText} keyboardType="decimal-pad" placeholder="e.g. 40" />
            <View style={{ marginTop: spacing.sm }}><Button title="Save estimate" size="sm" onPress={saveEstimate} /></View>
            {est ? (
              <View style={{ marginTop: spacing.md }}>
                <KV label="Estimated" value={`${est.estimateHours} labor-hours`} />
                <KV label="Actual" value={`${est.actualHours} labor-hours`} />
                <KV label="Difference" value={`${Math.abs(est.diffHours)} h ${est.over ? 'over' : 'under'}`} bold />
              </View>
            ) : null}
          </Card>
        </>
      ) : null}

      <Card title={`VISITS (${rows.length})`}>
        {rows.length === 0 ? <Empty icon="clock" text="No visits recorded in this date range." /> : rows.map((r, i) => {
          const vsTarget = r.elapsedMs != null && r.targetMinutes ? compareToTarget(r.elapsedMs, r.targetMinutes) : null;
          return (
            <Pressable key={r.visit.id} onPress={() => router.push({ pathname: '/(owner)/more/labor-visit', params: { id: r.visit.id } } as never)} accessibilityRole="button"
              style={[styles.vrow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}>
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{fmtDay(r.visit.visitDate)}{r.billable ? '' : '  · non-billable'}</Text>
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                  Elapsed {r.elapsedMs == null ? (r.status === 'in_progress' ? 'in progress' : '–') : durationText(r.elapsedMs)} · Crew labor {hoursText(r.laborMs)} h
                </Text>
                <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{r.employees.map((e) => e.name.split(' ')[0]).join(', ') || 'No employees'}{vsTarget ? ` · ${durationText(Math.abs(vsTarget.diffMs))} ${vsTarget.over ? 'over' : 'under'} target` : ''}</Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.textTertiary} />
            </Pressable>
          );
        })}
      </Card>
    </LaborScreen>
  );
}

const styles = StyleSheet.create({
  range: { flexDirection: 'row', gap: spacing.md },
  chips: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  vrow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
});
