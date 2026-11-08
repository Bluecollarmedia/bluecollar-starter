import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useLabor } from '@/hooks/useLabor';
import { useLaborTerms } from '@/hooks/useLaborTerms';
import { dailyCsv, dayRows, weekRows, weeklyCsv } from '@/lib/laborReports';
import { durationText, hoursText, weekStartKey } from '@/lib/timeCalc';
import { shareCsv } from '@/lib/exportCsv';
import { todayKey } from '@/lib/ids';
import { Card, Empty, KV, LaborScreen, NotInstalled, StatePill, fmtDay, money, shiftDay } from '@/components/time/LaborBits';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { db } from '@/data/store';

function say(title: string, message: string) {
  if (Platform.OS === 'web') (globalThis as { alert?: (m: string) => void }).alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/** One row per employee for the week: gross, breaks, net payable, regular vs overtime (with how it was worked out) and cost. */
export default function LaborWeekScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const termsOf = useLaborTerms();
  const [weekStart, setWeekStart] = useState(weekStartKey(todayKey()));
  const weekEnd = shiftDay(weekStart, 6);
  const L = useLabor(weekStart, weekEnd);
  const [open, setOpen] = useState<string | null>(null);

  const now = Date.now();
  const rows = useMemo(() => (L.snapshot ? weekRows(L.snapshot, weekStart, termsOf, now) : []), [L.snapshot, weekStart, termsOf, Math.floor(now / 30000)]);
  const days = useMemo(() => (L.snapshot ? dayRows(L.snapshot, now) : []), [L.snapshot, Math.floor(now / 30000)]);
  const totalNet = rows.reduce((t, r) => t + r.week.netMs, 0);
  const totalOt = rows.reduce((t, r) => t + r.week.overtimeMs, 0);
  const totalCost = rows.reduce((t, r) => t + (r.payCost ?? 0), 0);

  const exp = async (what: 'week' | 'days') => {
    try { await shareCsv(what === 'week' ? `weekly-hours-${weekStart}` : `daily-hours-${weekStart}`, what === 'week' ? weeklyCsv(rows) : dailyCsv(days)); }
    catch (e) { say("Couldn't export", e instanceof Error ? e.message : 'Try again.'); }
  };

  return (
    <LaborScreen title="Weekly Summary" subtitle={`${fmtDay(weekStart)} – ${fmtDay(weekEnd)}`} loading={L.loading && !L.snapshot} onRefresh={L.reload}>
      {L.notInstalled ? <NotInstalled /> : null}
      {L.error ? <Card><Text style={[typeScale.bodyMedium, { color: colors.error }]}>{L.error}</Text></Card> : null}
      <View style={styles.nav}>
        <Pressable onPress={() => setWeekStart(shiftDay(weekStart, -7))} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous week"><Icon name="chevron-left" size={26} color={colors.primary} /></Pressable>
        <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{weekStart === weekStartKey(todayKey()) ? 'This week' : `Week of ${fmtDay(weekStart)}`}</Text>
        <Pressable onPress={() => setWeekStart(shiftDay(weekStart, 7))} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next week"><Icon name="chevron-right" size={26} color={weekStart >= weekStartKey(todayKey()) ? colors.textTertiary : colors.primary} /></Pressable>
      </View>

      {!L.notInstalled ? (
        <>
          <Card title="TEAM TOTAL">
            <KV label="Net payable time" value={`${hoursText(totalNet)} h`} bold />
            <KV label="Overtime hours" value={`${hoursText(totalOt)} h`} hint="Per each employee's overtime terms" />
            <KV label="Payable cost" value={`$${totalCost.toFixed(2)}`} hint="Regular + overtime premium, at the saved rates" />
            <View style={styles.exp}>
              <Pressable onPress={() => exp('week')} style={styles.expBtn} accessibilityRole="button"><Icon name="download" size={16} color={colors.primary} /><Text style={[typeScale.labelSmall, { color: colors.primary }]}>Export weekly CSV</Text></Pressable>
              <Pressable onPress={() => exp('days')} style={styles.expBtn} accessibilityRole="button"><Icon name="download" size={16} color={colors.primary} /><Text style={[typeScale.labelSmall, { color: colors.primary }]}>Export daily CSV</Text></Pressable>
            </View>
          </Card>

          {rows.length === 0 ? <Card><Empty icon="clock" text="No workdays recorded this week." /></Card> : rows.map((r) => (
            <Card key={r.personId}>
              <Pressable onPress={() => setOpen(open === r.personId ? null : r.personId)} accessibilityRole="button" style={styles.head}>
                <View style={{ flex: 1 }}>
                  <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{r.personName}</Text>
                  <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{r.week.days.length} day(s){r.week.approved ? ' · all approved' : ''}</Text>
                </View>
                <Icon name={open === r.personId ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
              </Pressable>
              <KV label="Gross workday time" value={`${hoursText(r.week.grossMs)} h`} />
              <KV label="Recorded breaks" value={`${hoursText(r.week.recordedBreakMs)} h`} />
              <KV label="Break time deducted" value={`${hoursText(r.week.deductedBreakMs)} h`} />
              <KV label="Net payable time" value={`${hoursText(r.week.netMs)} h`} bold />
              <KV label="Regular hours" value={`${hoursText(r.week.regularMs)} h`} />
              <KV label="Overtime hours" value={`${hoursText(r.week.overtimeMs)} h`} hint={r.week.basis} />
              <KV label="Hourly rate" value={money(r.rate)} hint={r.rateChanged ? 'Changed during this week. Each day is priced at the rate saved with that day.' : undefined} />
              <KV label="Payable cost" value={r.payCost == null ? 'No rate set' : `$${r.payCost.toFixed(2)}`} bold />
              {open === r.personId ? days.filter((d) => d.workday.personId === r.personId && weekStartKey(d.workday.workDate) === weekStart).map((d) => (
                <Pressable key={d.workday.id} onPress={() => router.push({ pathname: '/(owner)/more/labor-day', params: { id: d.workday.id } } as never)} accessibilityRole="button"
                  style={[styles.day, { borderTopColor: colors.borderLight }]}>
                  <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, flex: 1 }]}>{fmtDay(d.workday.workDate)} · {durationText(d.summary.netMs)}</Text>
                  <StatePill state={d.state} />
                </Pressable>
              )) : null}
            </Card>
          ))}
          <Text style={[typeScale.caption, { color: colors.textTertiary, textAlign: 'center' }]}>
            Overtime here follows the terms set under Payroll for each employee. It is a calculation from your settings, not payroll processing or a legal determination.
          </Text>
        </>
      ) : null}
    </LaborScreen>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  exp: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  expBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  day: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 2 },
});
