import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { approveWorkday } from '@/data/timeTracking';
import { useLabor } from '@/hooks/useLabor';
import { dayRows } from '@/lib/laborReports';
import { durationText } from '@/lib/timeCalc';
import { todayKey } from '@/lib/ids';
import { Card, Empty, LaborScreen, NotInstalled, StatePill, fmtClock, fmtDay, shiftDay } from '@/components/time/LaborBits';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

function say(title: string, message: string) {
  if (Platform.OS === 'web') (globalThis as { alert?: (m: string) => void }).alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/** The payroll review queue: every day from the last two weeks that is not approved yet, newest first. Approve one at a time, or all that are ready. */
export default function LaborReviewScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const today = todayKey();
  const L = useLabor(shiftDay(today, -13), today);
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  const rows = useMemo(() => (L.snapshot ? dayRows(L.snapshot, now).filter((r) => r.state !== 'approved') : []), [L.snapshot, Math.floor(now / 30000)]);
  const readyRows = rows.filter((r) => r.state === 'ready' || r.state === 'reapproval');
  const dates = [...new Set(rows.map((r) => r.workday.workDate))].sort().reverse();

  async function approveOne(id: string) {
    setBusy(true);
    const r = await approveWorkday(id);
    setBusy(false);
    if (!r.ok) say("Can't approve yet", r.error);
    L.reload();
  }
  function approveAll() {
    const go = async () => {
      setBusy(true);
      let failed = 0;
      for (const r of readyRows) { const res = await approveWorkday(r.workday.id); if (!res.ok) failed++; }
      setBusy(false);
      if (failed) say('Some days were not approved', `${failed} day(s) couldn't be approved. Open them to see why.`);
      L.reload();
    };
    const msg = `Approve ${readyRows.length} day(s) that are ready? You can reopen any day later.`;
    Alert.alert('Approve all ready days?', msg, [{ text: 'Cancel', style: 'cancel' }, { text: 'Approve', onPress: go }]);
  }

  return (
    <LaborScreen title="Payroll Review" subtitle="Last 14 days" loading={L.loading && !L.snapshot} onRefresh={L.reload}>
      {L.notInstalled ? <NotInstalled /> : null}
      {L.error ? <Card><Text style={[typeScale.bodyMedium, { color: colors.error }]}>{L.error}</Text></Card> : null}
      {!L.notInstalled ? (
        <>
          <Card>
            <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>
              {rows.length === 0 ? 'Every day is approved.' : `${rows.length} day(s) waiting. ${readyRows.length} ready to approve.`}
            </Text>
            {readyRows.length > 1 ? (
              <Pressable onPress={approveAll} disabled={busy} style={[styles.btn, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]} accessibilityRole="button">
                <Icon name="check-circle" size={16} color="#FFFFFF" /><Text style={[typeScale.labelSmall, { color: '#FFFFFF' }]}>Approve all {readyRows.length} ready days</Text>
              </Pressable>
            ) : null}
          </Card>
          {rows.length === 0 ? <Card><Empty icon="check-circle" text="Nothing waiting for review." /></Card> : dates.map((d) => (
            <Card key={d} title={fmtDay(d).toUpperCase()}>
              {rows.filter((r) => r.workday.workDate === d).map((r, i) => (
                <View key={r.workday.id} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}>
                  <Pressable onPress={() => router.push({ pathname: '/(owner)/more/labor-day', params: { id: r.workday.id } } as never)} style={{ flex: 1 }} accessibilityRole="button">
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{r.personName}</Text>
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{fmtClock(r.workday.clockInAt)} – {r.workday.clockOutAt ? fmtClock(r.workday.clockOutAt) : 'not clocked out'} · Net payable {durationText(r.summary.netMs)}</Text>
                    {r.problems[0] ? <Text style={[typeScale.caption, { color: colors.warning }]}>{r.problems[0].message}</Text> : null}
                  </Pressable>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <StatePill state={r.state} />
                    {r.state === 'ready' || r.state === 'reapproval' ? (
                      <Pressable onPress={() => approveOne(r.workday.id)} disabled={busy} style={[styles.small, { backgroundColor: colors.primary }]} accessibilityRole="button"><Text style={[typeScale.labelSmall, { color: '#FFFFFF' }]}>Approve</Text></Pressable>
                    ) : (
                      <Pressable onPress={() => router.push({ pathname: '/(owner)/more/labor-day', params: { id: r.workday.id } } as never)} style={[styles.small, { backgroundColor: colors.backgroundTertiary }]} accessibilityRole="button"><Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>Review</Text></Pressable>
                    )}
                  </View>
                </View>
              ))}
            </Card>
          ))}
        </>
      ) : null}
    </LaborScreen>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.full, marginTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  small: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.full },
});
