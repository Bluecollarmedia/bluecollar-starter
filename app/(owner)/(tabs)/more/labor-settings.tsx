import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Button, Input, Switch } from '@/components/ui';
import { DateRow, NoteField } from '@/components/financials/FormBits';
import { FormSheet } from '@/components/materials/FormSheet';
import { ListSection } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { db, useDb } from '@/data/store';
import { DEFAULT_TIME_SETTINGS, loadAlertHours, loadTimeSettings, saveAlertHours, saveTimeSettings, setHourlyRate, type TimeSettings } from '@/data/timeTracking';
import { todayKey } from '@/lib/ids';
import { Card, Chip, LaborScreen, money } from '@/components/time/LaborBits';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

function say(title: string, message: string) {
  if (Platform.OS === 'web') (globalThis as { alert?: (m: string) => void }).alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

function currentRate(personId: string): number | null {
  const today = todayKey();
  const r = db.hourlyRates.filter((x) => x.personId === personId && x.effectiveDate <= today && (!x.endDate || x.endDate >= today)).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
  return r?.hourlyRate ?? null;
}

function Toggle({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.toggle}>
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{label}</Text>
        {hint ? <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} />
    </View>
  );
}

/** Hours & Labor settings. Every switch here controls real behaviour in the database (breaks, photo rules, alerts), not just the look of the screen. */
export default function LaborSettingsScreen() {
  const { colors } = useTheme();
  useDb();
  const [s, setS] = useState<TimeSettings>(DEFAULT_TIME_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [alertHours, setAlertHours] = useState<Record<string, string>>({});
  const [rateFor, setRateFor] = useState<string | null>(null);
  const [rateText, setRateText] = useState('');
  const [effective, setEffective] = useState(todayKey());
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!db.companyId) return;
    const r = await loadTimeSettings(db.companyId);
    if (r.ok) { setS(r.data); setLoaded(true); }
    const a = await loadAlertHours();
    if (a.ok) setAlertHours(Object.fromEntries(Object.entries(a.data).map(([k, v]) => [k, String(v)])));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function update(patch: Partial<TimeSettings>) {
    const next = { ...s, ...patch };
    setS(next);
    const r = await saveTimeSettings(db.companyId ?? '', next, db.personId);
    if (!r.ok) { say("Couldn't save", r.error); load(); }
  }
  async function saveHours(personId: string) {
    const t = (alertHours[personId] ?? '').trim();
    const n = t === '' ? null : Number(t);
    const r = await saveAlertHours(db.companyId ?? '', personId, n);
    if (!r.ok) say("Couldn't save", r.error);
  }
  async function saveRate() {
    if (!rateFor) return;
    const n = Number(rateText.replace(/[^0-9.]/g, ''));
    const r = await setHourlyRate(rateFor, n, effective, reason.trim() || undefined);
    if (!r.ok) { say("Couldn't change the rate", r.error); return; }
    setRateFor(null); setRateText(''); setReason('');
  }

  const workers = db.members.filter((m) => m.role === 'worker' && m.status === 'active');
  const nameOf = (id: string) => { const p = db.people[id]; return p ? `${p.firstName} ${p.lastName}`.trim() : 'Employee'; };

  return (
    <LaborScreen title="Hours & Labor Settings" loading={!loaded && !!db.companyId} onRefresh={load}>
      <Card title="BREAKS">
        <Toggle label="Track breaks" hint="Workers get a Start Break / End Break button. Off = no break is ever required or deducted." value={s.breaksEnabled} onChange={(v) => update({ breaksEnabled: v })} />
        <Toggle label="Recorded breaks are paid" hint={s.breaksPaid ? 'Break time stays in payable hours.' : 'Recorded break time is deducted from payable hours. Breaks nobody recorded are never deducted.'} value={s.breaksPaid} onChange={(v) => update({ breaksPaid: v })} disabled={!s.breaksEnabled} />
      </Card>

      <Card title="PHOTOS">
        <Toggle label="Photo when starting a property" hint="A worker can't start a property until the start photo is saved." value={s.requireStartPhoto} onChange={(v) => update({ requireStartPhoto: v })} />
        <Toggle label="Photo when completing a property" hint="A worker can't complete a property until the completion photo is saved." value={s.requireCompletePhoto} onChange={(v) => update({ requireCompletePhoto: v })} />
        <Text style={[typeScale.caption, { color: colors.textTertiary }]}>These photos are internal. They are never shown to customers.</Text>
      </Card>

      <Card title="ALERTS">
        <Toggle label="Over-target alerts" hint="Tell you when a property visit runs past its target (set per property in Property & Project History)." value={s.targetAlertsEnabled} onChange={(v) => update({ targetAlertsEnabled: v })} />
        <Toggle label="Prompt the crew too" hint="Sends the crew a neutral 'check your progress' message. It never shows the target." value={s.targetNotifyCrew} onChange={(v) => update({ targetNotifyCrew: v })} disabled={!s.targetAlertsEnabled} />
        <Toggle label="Daily overtime alerts" hint="Alerts for approaching and reaching each employee's daily alert hours (set below)." value={s.overtimeAlertsEnabled} onChange={(v) => update({ overtimeAlertsEnabled: v })} />
        <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.sm }]}>Approaching means this share of the daily alert hours:</Text>
        <View style={styles.chips}>{[80, 90, 95].map((p) => <Chip key={p} label={`${p}%`} on={s.approachPercent === p} onPress={() => update({ approachPercent: p })} />)}</View>
        <Input label="Flag a visit longer than (hours)" value={String(s.longVisitHours)} onChangeText={(t) => setS({ ...s, longVisitHours: Number(t.replace(/[^0-9.]/g, '')) || 0 })} onEndEditing={() => s.longVisitHours > 0 && update({ longVisitHours: s.longVisitHours })} keyboardType="decimal-pad" containerStyle={{ marginTop: spacing.md }} />
        <Input label="Flag a workday still open after (hours)" value={String(s.openWorkdayHours)} onChangeText={(t) => setS({ ...s, openWorkdayHours: Number(t.replace(/[^0-9.]/g, '')) || 0 })} onEndEditing={() => s.openWorkdayHours > 0 && update({ openWorkdayHours: s.openWorkdayHours })} keyboardType="decimal-pad" containerStyle={{ marginTop: spacing.sm }} />
        <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.sm }]}>Alerts are worked out when workers act or have the app open, and when you open Hours & Labor. There is no background scheduler.</Text>
      </Card>

      <Card title="EMPLOYEES: DAILY ALERT HOURS AND PAY RATE">
        {workers.length === 0 ? <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>No active workers yet.</Text> : workers.map((m) => (
          <View key={m.personId} style={[styles.emp, { borderTopColor: colors.borderLight }]}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{nameOf(m.personId)}</Text>
            <View style={styles.empRow}>
              <View style={{ flex: 1 }}>
                <Input label="Daily alert hours" value={alertHours[m.personId] ?? ''} onChangeText={(t) => setAlertHours((p) => ({ ...p, [m.personId]: t.replace(/[^0-9.]/g, '') }))} onEndEditing={() => saveHours(m.personId)} keyboardType="decimal-pad" placeholder="Off" />
              </View>
              <View style={{ flex: 1, alignItems: 'flex-end', gap: 6 }}>
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Hourly rate</Text>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{money(currentRate(m.personId))}</Text>
                <Button title="Change rate" size="sm" variant="secondary" onPress={() => { setRateFor(m.personId); setRateText(''); setEffective(todayKey()); setReason(''); }} />
              </View>
            </View>
          </View>
        ))}
        <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.sm }]}>A new rate starts on the date you pick; the old one is ended, not edited, so past labor costs keep the rate that applied.</Text>
      </Card>

      <FormSheet visible={!!rateFor} title="Change hourly rate" saveLabel="Save" onSave={saveRate} onClose={() => setRateFor(null)}>
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginBottom: spacing.md }]}>{rateFor ? nameOf(rateFor) : ''}. Work done before the start date keeps its old rate.</Text>
        <ListSection title="NEW HOURLY RATE ($)"><Input label="Rate" value={rateText} onChangeText={setRateText} keyboardType="decimal-pad" placeholder="e.g. 22.50" /></ListSection>
        <ListSection><DateRow label="Starts on" value={effective} onChange={setEffective} /></ListSection>
        <ListSection title="REASON (OPTIONAL)"><NoteField label="Reason" placeholder="e.g. Annual raise" value={reason} onChangeText={setReason} /></ListSection>
      </FormSheet>
    </LaborScreen>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  emp: { paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  empRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
});
